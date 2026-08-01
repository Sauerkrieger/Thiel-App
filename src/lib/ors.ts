/**
 * OpenRouteService (ORS)-Helfer.
 *
 * ORS unterstützt zwei Schlüssel-Typen mit unterschiedlichem
 * Authorization-Header:
 *   - Kostenlose Standard-Keys (40-stelliger Hex-String) -> "apikey <key>"
 *   - Premium-Keys (JWT, beginnt mit "eyJ")              -> "Bearer <key>"
 *
 * Ein falscher Header führt zu HTTP 403 ("Access to this API has been
 * disallowed"), daher wird hier automatisch der passende Header gewählt.
 */
export function orsAuthorizationHeader(apiKey: string): string {
  return apiKey.startsWith("eyJ") ? `Bearer ${apiKey}` : `apikey ${apiKey}`;
}

/**
 * Entfernt Stadtteil-Suffixe (z. B. "97072 Würzburg-Altstadt" → "97072 Würzburg"),
 * die ORS zu Fehl-Geocoding verleiten (z. B. Dresden statt Würzburg).
 * Betrifft nur den PLZ+Ort-Teil am Ende der Adresse – Straßennamen bleiben unberührt.
 * Hinweis: Echte zusammengesetzte Ortsnamen mit Bindestrich (z. B. "Bad Neuenahr-Ahrweiler")
 * werden dabei auf den ersten Teil gekürzt – im Würzburg-Kontext akzeptabel.
 */
export function normalizeAddressForGeocoding(address: string): string {
  const match = address.match(
    /^(.*,\s*\d{5}\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*)-[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*$/u,
  );
  if (!match) return address;
  return match[1].trimEnd();
}

/** Von ORS geocodeter Treffer (Geocode-Search). */
export type OrsGeocodeHit = {
  label: string;
  name: string;
  latitude: number;
  longitude: number;
};

/**
 * ORS-Geocode-Search (vollständige Adresssuche, DEU-begrenzt) und liefert
 * den besten Treffer mit Label + Koordinaten. null bei Fehler/kein Key.
 */
export async function orsGeocodeSearch(
  query: string,
): Promise<OrsGeocodeHit | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL("https://api.openrouteservice.org/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("size", "1");
    url.searchParams.set("lang", "de");
    url.searchParams.set("boundary.country", "DEU");
    const res = await fetch(url, {
      headers: { Authorization: orsAuthorizationHeader(apiKey) },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: {
      features?: Array<{
        geometry?: { coordinates?: unknown };
        properties?: { label?: string; name?: string };
      }>;
    } = await res.json();
    const feature = json.features?.[0];
    const coords = feature?.geometry?.coordinates;
    const [lng, lat] = Array.isArray(coords) ? coords : [];
    const label = feature?.properties?.label?.trim();
    if (
      !label ||
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return null;
    }
    return {
      label,
      name: feature?.properties?.name?.trim() ?? "",
      latitude: lat,
      longitude: lng,
    };
  } catch {
    return null;
  }
}
