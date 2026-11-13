/**
 * Photon-Geocoding-Client (Komoot) – Fuzzy-Suche mit Tippfehler-Toleranz.
 *
 * Photon ist ein Open-Source-Geocoder basierend auf OpenStreetMap-Daten.
 * Die öffentliche Instanz photon.komoot.io ist kostenlos und erfordert
 * KEINEN API-Key. Sie eignet sich hervorragend als Fallback, wenn ORS
 * aufgrund von Rechtschreibfehlern oder leicht abweichenden Adressen
 * keine Treffer liefert.
 *
 * Rate-Limits: Fair Use (einige tausend Requests/Minute insgesamt).
 * Bei intensiver Nutzung empfiehlt sich ein selbst-gehosteter Photon-Server.
 *
 * API: https://photon.komoot.io/api?q=...&limit=...&lang=de&bbox=...
 * Response: GeoJSON-FeatureCollection mit geometry.coordinates [lng, lat]
 * und properties (name, street, housenumber, city, postcode, countrycode,
 * type, osm_id, extent).
 */

import { cleanAddressLabel } from "@/lib/address";
import type { OrsBoundaryRect } from "@/lib/ors";
import { normalizeForScoring, extractHouseNumber } from "@/lib/ors";

const PHOTON_API_URL = "https://photon.komoot.io/api";

/** Würzburg-Stadtmitte – Standort-Bias für lokale Treffer-Priorisierung. */
const WUERZBURG_BIAS_LAT = 49.79;
const WUERZBURG_BIAS_LON = 9.95;

/* ------------------------------------------------------------------ */
/* Typen                                                               */
/* ------------------------------------------------------------------ */

export type PhotonGeocodeHit = {
  label: string;
  name: string;
  latitude: number;
  longitude: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    postcode?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
    osm_id?: unknown;
    extent?: unknown;
  };
};

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Baut ein lesbares Label aus Photon-Properties (Straße + HN, PLZ + Stadt). */
function buildLabel(props: PhotonFeature["properties"]): string {
  const parts: string[] = [];
  const street = props?.street?.trim();
  const hn = props?.housenumber?.trim();
  if (street) parts.push(hn ? `${street} ${hn}` : street);
  const city = props?.city?.trim();
  const plz = props?.postcode?.trim();
  if (city) parts.push(plz ? `${plz} ${city}` : city);
  return parts.join(", ");
}

/* ------------------------------------------------------------------ */
/* Geocode-Search                                                      */
/* ------------------------------------------------------------------ */

/**
 * Photon-Geocode-Search – fuzzy/tolerant, ideal für Tippfehler.
 *
 * @param query     Vollständige Adresse (z. B. "Hörleinsgasse 12, Würzburg")
 * @param boundary  Optionales Rechteck zur clientseitigen Filterung
 * @param limit     Max. Ergebnisse (Default 5)
 */
export async function photonGeocodeSearch(
  query: string,
  options?: { boundary?: OrsBoundaryRect; limit?: number },
): Promise<PhotonGeocodeHit | null> {
  const limit = options?.limit ?? 5;
  const boundary = options?.boundary;

  try {
    const url = new URL(PHOTON_API_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "de");
    // Standort-Bias: Würzburg-Zentrum priorisieren
    url.searchParams.set("lat", String(WUERZBURG_BIAS_LAT));
    url.searchParams.set("lon", String(WUERZBURG_BIAS_LON));

    // Bounding-Box, falls gesetzt (Würzburg-Regel)
    if (boundary) {
      url.searchParams.set(
        "bbox",
        `${boundary.minLon},${boundary.minLat},${boundary.maxLon},${boundary.maxLat}`,
      );
    }

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const json: { features?: PhotonFeature[] } = await res.json();
    const features = json.features ?? [];

    const normQuery = normalizeForScoring(query);
    const queryTokens = normQuery.split(/\s+/).filter(Boolean);
    const queryHouseNumber = extractHouseNumber(normQuery);

    let best: PhotonGeocodeHit | null = null;
    let bestScore = -1;

    for (const feature of features) {
      const coords = feature?.geometry?.coordinates;
      const [lng, lat] = Array.isArray(coords) ? coords : [];
      if (!isNumber(lat) || !isNumber(lng)) continue;

      const props = feature.properties;
      // Nur echte Straßen-/Haus-Adressen (keine POIs, Städte, etc.)
      const type = props?.type;
      if (type === "city" || type === "state" || type === "district" || type === "country") {
        continue;
      }

      // Clientseitige Boundary-Filterung (Redundanz zur BBOX, aber sicherer)
      if (boundary) {
        const inside =
          lng >= boundary.minLon &&
          lng <= boundary.maxLon &&
          lat >= boundary.minLat &&
          lat <= boundary.maxLat;
        if (!inside) continue;
      }

      const label = buildLabel(props);
      if (!label) continue;

      // Ähnlichkeitsscore
      const normLabel = normalizeForScoring(label);
      let score = 0;
      for (const token of queryTokens) {
        if (normLabel.includes(token)) score += 1;
      }
      if (
        queryHouseNumber !== null &&
        extractHouseNumber(normLabel) === queryHouseNumber
      ) {
        score += 3;
      }

      if (score > bestScore) {
        bestScore = score;
        best = {
          label: cleanAddressLabel(label),
          name: props?.name?.trim() ?? label,
          latitude: lat,
          longitude: lng,
        };
      }
    }

    return best;
  } catch {
    return null;
  }
}

/**
 * Photon-Autocomplete – liefert eine Liste von Vorschlägen für
 * teilweise eingegebene Adressen (z. B. während der Texteingabe).
 *
 * Als Fallback, wenn ORS-Autocomplete nicht verfügbar ist oder
 * keine Ergebnisse liefert.
 */
export type PhotonSuggestion = PhotonGeocodeHit;

export async function photonAutocomplete(
  query: string,
  options?: { limit?: number },
): Promise<PhotonSuggestion[]> {
  const limit = options?.limit ?? 6;

  try {
    const url = new URL(PHOTON_API_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "de");
    // Standort-Bias: Würzburg-Zentrum priorisieren
    url.searchParams.set("lat", String(WUERZBURG_BIAS_LAT));
    url.searchParams.set("lon", String(WUERZBURG_BIAS_LON));

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];

    const json: { features?: PhotonFeature[] } = await res.json();
    const features = json.features ?? [];

    return features
      .map((f): PhotonSuggestion | null => {
        const coords = f?.geometry?.coordinates;
        const [lng, lat] = Array.isArray(coords) ? coords : [];
        if (!isNumber(lat) || !isNumber(lng)) return null;
        const props = f.properties;
        const label = buildLabel(props);
        if (!label) return null;
        return {
          label: cleanAddressLabel(label),
          name: props?.name?.trim() ?? label,
          latitude: lat,
          longitude: lng,
        };
      })
      .filter((s): s is PhotonSuggestion => s !== null);
  } catch {
    return [];
  }
}
