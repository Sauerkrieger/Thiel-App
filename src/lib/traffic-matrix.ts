/**
 * TomTom Routing Matrix API – Live-Verkehrs-Fahrzeitmatrix.
 *
 * Holt für eine Liste von Koordinaten die aktuelle Fahrzeit in Sekunden
 * (inkl. Live-Verkehr) als N×N-Matrix. Diese wird dem VROOM-Optimierer als
 * Custom-Matrix übergeben, damit die Routenberechnung echte Staulagen
 * berücksichtigt (statt der statischen ORS-Fahrzeiten).
 *
 * Endpoint: POST https://api.tomtom.com/routing/matrix/1/json
 *   - routeType=fastest + traffic=true → travelTimeInSeconds enthält Stauzeit
 *   - Sync-Limit: max. 100 Origins & 100 Destinations pro Request
 *
 * Gibt null zurück, wenn kein Key konfiguriert ist oder die Anfrage
 * fehlschlägt/unvollständig ist – der Aufrufer fällt dann auf die
 * Standard-Berechnung (ORS) zurück.
 */

/** TomTom Sync-Matrix-Limit (Origins/Destinations). */
export const MAX_TOMTOM_MATRIX_LOCATIONS = 100;

export type TrafficMatrix = {
  /**
   * Fahrzeiten in Sekunden (row-major, N×N) inkl. Live-Verkehr.
   * Index-Reihenfolge = Reihenfolge der übergebenen `locations`.
   */
  durations: number[][];
  provider: "tomtom";
};

/**
 * Fragt die Live-Verkehrs-Fahrzeitmatrix bei TomTom ab.
 *
 * @param locations Koordinaten in exakt der Reihenfolge, in der sie später
 *   als VROOM-Jobs/Depot verwendet werden (kein Versatz!).
 */
export async function fetchTomTomTrafficMatrix(
  locations: { lat: number; lng: number }[],
): Promise<TrafficMatrix | null> {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return null;
  if (locations.length > MAX_TOMTOM_MATRIX_LOCATIONS) {
    console.warn(
      `[TomTom] Matrix übersprungen: ${locations.length} Orte > ${MAX_TOMTOM_MATRIX_LOCATIONS} – nutze Standard-Fahrzeiten.`,
    );
    return null;
  }

  const points = locations.map((l) => ({
    point: { latitude: l.lat, longitude: l.lng },
  }));

  try {
    const url = `https://api.tomtom.com/routing/matrix/1/json?key=${encodeURIComponent(apiKey)}&routeType=fastest&traffic=true`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origins: points, destinations: points }),
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
    const json = await res.json();
    const matrix = json?.data?.matrix as
      | Array<
          Array<{ statusCode?: string; routeSummary?: { travelTimeInSeconds?: number } }>
        >
      | undefined;

    if (
      !Array.isArray(matrix) ||
      matrix.length !== locations.length ||
      !matrix.every((row) => Array.isArray(row) && row.length === locations.length)
    ) {
      console.error("[TomTom] Matrix-Antwort unerwartet (Format passt nicht):", json);
      return null;
    }

    const durations: number[][] = [];
    for (const row of matrix) {
      const durationRow: number[] = [];
      for (const cell of row) {
        const seconds = cell?.routeSummary?.travelTimeInSeconds;
        // Fehlender Wert (z. B. statusCode != "OK") → komplette Matrix verwerfen,
        // damit VROOM keine Lücken bekommt.
        if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
          console.warn(
            "[TomTom] Matrix-Zelle ohne gültige Fahrzeit – verwende Standard-Fahrzeiten.",
          );
          return null;
        }
        durationRow.push(Math.round(seconds));
      }
      durations.push(durationRow);
    }

    return { durations, provider: "tomtom" };
  } catch (err) {
    console.error("[TomTom] Matrix-Anfrage fehlgeschlagen:", err);
    return null;
  }
}
