/**
 * TomTom Matrix Routing v2 API – Live-Verkehrs-Fahrzeitmatrix.
 *
 * Holt für eine Liste von Koordinaten die aktuelle Fahrzeit in Sekunden
 * (inkl. Live-Verkehr) als N×N-Matrix. Diese wird dem VROOM-Optimierer als
 * Custom-Matrix übergeben, damit die Routenberechnung echte Staulagen
 * berücksichtigt (statt der statischen ORS-Fahrzeiten).
 *
 * Endpoint (Synchronous Matrix, v2):
 *   POST https://api.tomtom.com/routing/matrix/2?key={API_KEY}
 *   Body: { origins, destinations, options: { departAt: "now", routeType:
 *   "fastest", traffic: "live", travelMode: "car" } }
 *
 * Live-Verkehr: traffic=live berücksichtigt Staus + Sperrungen im
 * Reisezeitfenster; departAt=now nutzt immer die aktuellsten Verkehrsdaten.
 *
 * Sync-Limits: max. 2500 Matrix-Zellen (origins × destinations), max. 100
 * Origins/Destinations pro Request. Gibt null zurück, wenn kein Key
 * konfiguriert ist, das Limit überschritten wird oder die Anfrage
 * fehlschlägt/unvollständig ist – der Aufrufer fällt dann auf die
 * Standard-Berechnung (ORS) zurück.
 */

/** TomTom Sync-Hardlimit: Anzahl Matrix-Zellen (origins × destinations). */
export const MAX_TOMTOM_MATRIX_CELLS = 2500;

/**
 * Zellen-Limit (origins × destinations) für die TomTom-Sync-Matrix.
 * Per Env-Variable TOMTOM_MAX_CELLS übersteuerbar – der Free-Tier ist nur
 * auf ~100 Zellen begrenzt, größere Touren brauchen dann einen höheren
 * Plan oder den Fallback ohne Live-Verkehr.
 */
function maxTomTomCells(): number {
  const raw = Number(process.env.TOMTOM_MAX_CELLS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MAX_TOMTOM_MATRIX_CELLS;
}

/** TomTom Sync-Limit: maximale Anzahl Origins/Destinations pro Request. */
export const MAX_TOMTOM_MATRIX_LOCATIONS = 100;

export type TrafficMatrix = {
  /**
   * Fahrzeiten in Sekunden (row-major, N×N) inkl. Live-Verkehr.
   * Index-Reihenfolge = Reihenfolge der übergebenen `locations`.
   * Zellen, die TomTom nicht routen konnte, werden aus der Fallback-Matrix
   * aufgefüllt (ORS/Haversine) – Live-Verkehr also „wo verfügbar".
   */
  durations: number[][];
  provider: "tomtom";
};

type TomTomCell = {
  originIndex?: number;
  destinationIndex?: number;
  routeSummary?: { travelTimeInSeconds?: number };
  detailedError?: { code?: string; message?: string };
};

type TomTomResponse = {
  data?: TomTomCell[];
  statistics?: { totalCount?: number; successes?: number; failures?: number };
};

/**
 * Baut aus der flachen TomTom-v2-Antwort (data-Array mit originIndex/
 * destinationIndex) die N×N-Dauer-Matrix in Sekunden.
 *
 * Fehlgeschlagene Zellen (z. B. detailedError / NO_ROUTE_FOUND) werden als
 * NaN markiert und NICHT als Gesamtfehler behandelt – der Aufrufer füllt sie
 * anschließend aus einer Fallback-Matrix (ORS/Haversine) auf. So kippt eine
 * einzelne unerreichbare Zelle nicht den kompletten Live-Verkehr.
 *
 * Gibt nur dann null zurück, wenn die Antwort strukturell unbrauchbar ist
 * (kein data-Array).
 */
export function parseTomTomMatrixResponse(
  json: TomTomResponse,
  count: number,
): number[][] | null {
  const cells = json?.data;
  if (!Array.isArray(cells)) {
    console.warn(
      "[TomTom] Matrix-Antwort unerwartet (kein data-Array) – verwende Standard-Fahrzeiten.",
    );
    return null;
  }

  const matrix: number[][] = Array.from({ length: count }, () =>
    new Array<number>(count).fill(Number.NaN),
  );

  let failedCells = 0;
  for (const cell of cells) {
    const { originIndex, destinationIndex, routeSummary, detailedError } = cell;
    const seconds = routeSummary?.travelTimeInSeconds;
    if (
      typeof originIndex !== "number" ||
      typeof destinationIndex !== "number" ||
      originIndex < 0 ||
      destinationIndex < 0 ||
      originIndex >= count ||
      destinationIndex >= count ||
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      // Nur die ersten Fehler einzeln loggen, Rest zusammenfassen (Log-Spam)
      if (failedCells < 3) {
        console.warn(
          `[TomTom] Matrix-Zelle (${originIndex}→${destinationIndex}) fehlgeschlagen: ${detailedError?.code ?? "unbekannt"} – wird per Fallback gefüllt (falls verfügbar).`,
        );
      }
      failedCells++;
      continue; // Zelle bleibt NaN → Fallback im Aufrufer
    }
    matrix[originIndex][destinationIndex] = Math.round(seconds);
  }
  if (failedCells > 3) {
    console.warn(
      `[TomTom] Matrix: ${failedCells} Zelle(n) fehlgeschlagen – werden per Fallback gefüllt (falls verfügbar).`,
    );
  }

  // Diagonale (i→i) ist immer 0 – auch wenn TomTom keinen travelTime liefert.
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(matrix[i][i])) matrix[i][i] = 0;
  }

  return matrix;
}

/**
 * Fragt die Live-Verkehrs-Fahrzeitmatrix bei TomTom ab.
 *
 * @param locations Koordinaten in exakt der Reihenfolge, in der sie später
 *   als VROOM-Jobs/Depot verwendet werden (kein Versatz!).
 * @param fallbackDurations Optionale Funktion, die eine N×N-Fahrzeitmatrix
 *   in Sekunden (gleiche Reihenfolge) liefert. Zellen, die TomTom nicht
 *   routen kann (z. B. NO_ROUTE_FOUND), werden daraus aufgefüllt, damit eine
 *   einzelne unerreichbare Koordinate nicht den kompletten Live-Verkehr
 *   ausfallen lässt.
 */
export async function fetchTomTomTrafficMatrix(
  locations: { lat: number; lng: number }[],
  fallbackDurations?: () => Promise<number[][] | null>,
): Promise<TrafficMatrix | null> {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return null;
  if (locations.length > MAX_TOMTOM_MATRIX_LOCATIONS) {
    console.warn(
      `[TomTom] Matrix übersprungen: ${locations.length} Orte > ${MAX_TOMTOM_MATRIX_LOCATIONS} – nutze Standard-Fahrzeiten.`,
    );
    return null;
  }
  const maxCells = maxTomTomCells();
  if (locations.length * locations.length > maxCells) {
    console.warn(
      `[TomTom] Matrix übersprungen: ${locations.length}² Zellen > Limit ${maxCells} (steuerbar über TOMTOM_MAX_CELLS) – nutze Standard-Fahrzeiten.`,
    );
    return null;
  }

  const points = locations.map((l) => ({
    point: { latitude: l.lat, longitude: l.lng },
  }));

  try {
    // Hinweis: aktueller Endpoint OHNE /json-Suffix (Matrix Routing v2)
    const url = `https://api.tomtom.com/routing/matrix/2?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origins: points,
        destinations: points,
        options: {
          departAt: "now",
          routeType: "fastest",
          traffic: "live",
          travelMode: "car",
        },
      }),
      cache: "no-store",
      // Verhindert, dass ein hängender TomTom-Call die Routenberechnung blockiert
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(
        `[TomTom] Matrix-Anfrage fehlgeschlagen (Status ${res.status}):`,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = (await res.json()) as TomTomResponse;
    const matrix = parseTomTomMatrixResponse(json, locations.length);
    if (!matrix) return null;

    // Fehlende Zellen (NaN) aus der Fallback-Matrix auffüllen, damit EINE
    // unerreichbare Zelle nicht den kompletten Live-Verkehr kippt.
    let missing = false;
    outer: for (const row of matrix) {
      for (const value of row) {
        if (!Number.isFinite(value)) {
          missing = true;
          break outer;
        }
      }
    }
    if (missing) {
      const fallback = fallbackDurations ? await fallbackDurations() : null;
      const fallbackUsable =
        fallback &&
        fallback.length === locations.length &&
        fallback.every((row) => row.length === locations.length);
      if (fallbackUsable) {
        for (let i = 0; i < locations.length; i++) {
          for (let j = 0; j < locations.length; j++) {
            if (!Number.isFinite(matrix[i][j])) {
              const fb = fallback[i]?.[j];
              if (typeof fb === "number" && Number.isFinite(fb) && fb >= 0) {
                matrix[i][j] = Math.round(fb);
              }
            }
          }
        }
      } else if (missing) {
        console.warn(
          "[TomTom] Fallback-Matrix fehlt oder passt nicht zur Anfrage – Zellen bleiben ohne Wert.",
        );
      }
    }

    // Immer noch unvollständig → ohne Live-Verkehr rechnen (Fallback reicht nicht)
    for (const row of matrix) {
      for (const value of row) {
        if (!Number.isFinite(value)) {
          console.warn(
            "[TomTom] Matrix unvollständig (Fallback reicht nicht) – verwende Standard-Fahrzeiten.",
          );
          return null;
        }
      }
    }
    return { durations: matrix, provider: "tomtom" };
  } catch (err) {
    console.error("[TomTom] Matrix-Anfrage fehlgeschlagen:", err);
    return null;
  }
}
