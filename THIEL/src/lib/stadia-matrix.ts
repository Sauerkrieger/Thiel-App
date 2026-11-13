/**
 * Stadia Maps Valhalla Time-Distance Matrix API – kostenloser Fallback
 * für die TomTom-Verkehrsmatrix.
 *
 * Stadia Maps hostet den Valhalla-Routing-Engine und bietet eine
 * kostenlose Stufe (200.000 Credits/Monat, kommerzielle Nutzung erlaubt).
 * Die Matrix kostet 10 Credits pro Element (sources × targets).
 *
 * API-Key: STADIA_API_KEY (Umgebungsvariable)
 * Endpoint: POST https://api.stadiamaps.com/matrix/v1?api_key=...
 *
 * Limits (Standard-Plan):
 *   - Max. 625 Elemente (z. B. 25 sources × 25 targets)
 *   - Max. B-Line-Distanz: 400 km (auto) / 200 km (andere Profile)
 *
 * Hinweis: Die Stadia-Matrix liefert KEINE Live-Verkehrsdaten, sondern
 * statische Fahrzeiten basierend auf OSM-Daten (wie ORS). Sie dient als
 * zusätzlicher Fallback, wenn TomTom-Credits erschöpft sind.
 */

/* ------------------------------------------------------------------ */
/* Typen                                                               */
/* ------------------------------------------------------------------ */

export type StadiaMatrixResult = {
  /** Fahrzeiten in Sekunden (sources × targets). */
  durations: number[][];
  /** Distanzen in Kilometern (sources × targets). */
  distances: number[][];
  provider: "stadia";
};

type StadiaRequest = {
  id: string;
  sources: { lat: number; lon: number }[];
  targets: { lat: number; lon: number }[];
  costing: "auto";
};

type StadiaCell = {
  distance: number | null;
  time: number | null;
  from_index: number;
  to_index: number;
};

type StadiaResponse = {
  sources_to_targets?: StadiaCell[][];
};

/* ------------------------------------------------------------------ */
/* Max. Elemente (sources × targets) für den Standard-Plan             */
/* ------------------------------------------------------------------ */

const MAX_STADIA_ELEMENTS = 625;

/** Maximale B-Line-Distanz in km für das Auto-Profil. */
const MAX_BLINE_DISTANCE_KM = 400;

/* ------------------------------------------------------------------ */
/* B-Line-Prüfung                                                      */
/* ------------------------------------------------------------------ */

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function maxBLineDistanceKm(
  locations: { lat: number; lng: number }[],
): number {
  let max = 0;
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const d = haversineKm(locations[i], locations[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

/* ------------------------------------------------------------------ */
/* Matrix-Client                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fragt die Stadia-Maps-Zeit-/Distanzmatrix ab.
 *
 * @param locations  Koordinaten (identisch für sources + targets,
 *                   d. h. symmetrische N×N-Matrix).
 * @returns Matrix mit Fahrzeiten (Sekunden) und Distanzen (km),
 *          oder null bei Fehler/Überschreitung.
 */
export async function fetchStadiaMatrix(
  locations: { lat: number; lng: number }[],
): Promise<StadiaMatrixResult | null> {
  const apiKey = process.env.STADIA_API_KEY;
  if (!apiKey) return null;

  const count = locations.length;

  // Elemente-Limit prüfen
  if (count * count > MAX_STADIA_ELEMENTS) {
    console.warn(
      `[Stadia] Matrix übersprungen: ${count}² = ${count * count} Elemente > Limit ${MAX_STADIA_ELEMENTS} – nutze Fallback.`,
    );
    return null;
  }

  // B-Line-Distanz prüfen
  const bline = maxBLineDistanceKm(locations);
  if (bline > MAX_BLINE_DISTANCE_KM) {
    console.warn(
      `[Stadia] Matrix übersprungen: B-Line-Distanz ${bline.toFixed(1)} km > Limit ${MAX_BLINE_DISTANCE_KM} km.`,
    );
    return null;
  }

  const body: StadiaRequest = {
    id: "thiel-tour",
    sources: locations.map((l) => ({ lat: l.lat, lon: l.lng })),
    targets: locations.map((l) => ({ lat: l.lat, lon: l.lng })),
    costing: "auto",
  };

  try {
    const res = await fetch(
      `https://api.stadiamaps.com/matrix/v1?api_key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      console.error(
        `[Stadia] Matrix-Anfrage fehlgeschlagen (Status ${res.status}):`,
        await res.text().catch(() => ""),
      );
      return null;
    }

    const json = (await res.json()) as StadiaResponse;
    const cells = json?.sources_to_targets;
    if (!Array.isArray(cells) || cells.length !== count) {
      console.warn(
        "[Stadia] Matrix-Antwort unerwartet – sources_to_targets fehlt oder passt nicht.",
      );
      return null;
    }

    const durations: number[][] = [];
    const distances: number[][] = [];
    let hasNaN = false;

    for (let i = 0; i < count; i++) {
      const row = cells[i];
      if (!Array.isArray(row) || row.length !== count) return null;
      const durRow: number[] = [];
      const distRow: number[] = [];
      for (let j = 0; j < count; j++) {
        const cell = row[j];
        const time = cell?.time;
        const dist = cell?.distance;
        if (typeof time === "number" && Number.isFinite(time) && time >= 0) {
          durRow.push(Math.round(time));
        } else {
          durRow.push(Number.NaN);
          hasNaN = true;
        }
        if (typeof dist === "number" && Number.isFinite(dist) && dist >= 0) {
          distRow.push(dist);
        } else {
          distRow.push(Number.NaN);
        }
      }
      durations.push(durRow);
      distances.push(distRow);
    }

    if (hasNaN) {
      console.warn(
        "[Stadia] Matrix enthält ungültige Zellen – wird teilweise per Fallback gefüllt.",
      );
    }

    return { durations, distances, provider: "stadia" };
  } catch (err) {
    console.error("[Stadia] Matrix-Anfrage fehlgeschlagen:", err);
    return null;
  }
}
