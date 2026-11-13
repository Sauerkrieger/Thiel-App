/**
 * Konfiguration des Einsatzgebiets.
 *
 * Ohne gesetzte Variablen arbeitet die App ortsunabhängig: Es wird keine Stadt
 * ergänzt, keine Geocoding-Suche begrenzt und kein Standort-Bias gesetzt.
 * Sobald ein Einsatzgebiet konfiguriert ist, gilt die „Einsatzgebiets-Regel“
 * (Adressen ohne Ortsangabe gehören zum Einsatzgebiet).
 */

/** Rechteck-Begrenzung für die clientseitige Boundary-Filterung. */
export type ServiceAreaRect = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/** Stadt des Einsatzgebiets; wird bei Adressen ohne Ortsangabe ergänzt. */
export const SERVICE_CITY = process.env.NEXT_PUBLIC_SERVICE_CITY?.trim() || "";

function toNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Kartenmittelpunkt für die Treffer-Priorisierung (optional). */
export const SERVICE_CITY_BIAS: { lat: number; lon: number } | null = (() => {
  const lat = toNumber(process.env.NEXT_PUBLIC_SERVICE_CITY_LAT);
  const lon = toNumber(process.env.NEXT_PUBLIC_SERVICE_CITY_LON);
  return lat !== null && lon !== null ? { lat, lon } : null;
})();

/**
 * Suchgrenze des Einsatzgebiets als „minLon,minLat,maxLon,maxLat“ (optional).
 * `undefined` = keine Begrenzung (Adressen werden weltweit gesucht).
 */
export const SERVICE_AREA_BOUNDARY: ServiceAreaRect | undefined = (() => {
  const parts = (process.env.NEXT_PUBLIC_SERVICE_AREA_BOUNDARY ?? "")
    .split(",")
    .map((part) => part.trim());
  if (parts.length !== 4) return undefined;
  const [minLon, minLat, maxLon, maxLat] = parts.map((part) => toNumber(part));
  if (
    minLon === null ||
    minLat === null ||
    maxLon === null ||
    maxLat === null
  ) {
    return undefined;
  }
  return { minLon, minLat, maxLon, maxLat };
})();

/** Punkt im Einsatzgebiet. */
export type RegionPoint = { lat: number; lng: number };

/**
 * Lokale Fußgängerzonen-Polygone als Ausfall-Fallback, wenn die Overpass-API
 * nicht erreichbar ist. Leer = es wird ausschließlich Overpass befragt.
 * Für ein Einsatzgebiet mit bekannten Fußgängerzonen hier Polygone eintragen.
 */
export const PEDESTRIAN_FALLBACK_POLYGONS: RegionPoint[][] = [];
