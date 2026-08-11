import { cleanAddressLabel } from "@/lib/address";

/** Rechteck-Begrenzung für clientseitige Boundary-Filterung. */
export type OrsBoundaryRect = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/**
 * Würzburg (Stadtgebiet) – wird genutzt, wenn eine Adresse ohne Ortsangabe
 * "geraten" werden muss (Foto-Import). Es darf dann das gesamte Würzburger
 * Stadtgebiet durchsucht werden; Treffer außerhalb werden verworfen.
 */
export const WUERZBURG_BOUNDARY: OrsBoundaryRect = {
  minLon: 9.87,
  minLat: 49.69,
  maxLon: 10.1,
  maxLat: 49.89,
};

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
 * Entfernt Stadtteil-Suffixe (z. B. "97072 Würzburg-Altstadt" -> "97072 Würzburg"),
 * die ORS zu Fehl-Geocoding verleiten (z. B. Dresden statt Würzburg).
 * Betrifft nur den PLZ+Ort-Teil am Ende der Adresse – Straßennamen bleiben unberührt.
 * Hinweis: Echte zusammengesetzte Ortsnamen mit Bindestrich (z. B. "Bad Neuenahr-Ahrweiler")
 * werden dabei auf den ersten Teil gekürzt – im Würzburg-Kontext akzeptabel.
 */
export function normalizeAddressForGeocoding(address: string): string {
  // "Musterstraße 12, 97072 Würzburg-Frauenland" -> "Musterstraße 12, 97072 Würzburg"
  const plzMatch = address.match(
    /^(.*,\s*\d{5}\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*)-[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*$/u,
  );
  if (plzMatch) return plzMatch[1].trimEnd();
  // "Testweg 1, Würzburg-Heidingsfeld" (ohne PLZ) -> "Testweg 1, Würzburg"
  const cityMatch = address.match(
    /^(.*,\s*)(Würzburg|würzburg|Wuerzburg|wuerzburg)-[A-Za-zÄÖÜäöüß]+\s*$/u,
  );
  if (cityMatch) {
    const beforeCity = cityMatch[1].replace(/,\s*$/, "");
    return `${beforeCity}, Würzburg`;
  }
  return address;
}

/** Von ORS geocodeter Treffer (Geocode-Search). */
export type OrsGeocodeHit = {
  label: string;
  name: string;
  latitude: number;
  longitude: number;
};

/* ------------------------------------------------------------------ */
/* Ähnlichkeits-Helfer                                                 */
/* ------------------------------------------------------------------ */

/** Normalisiert einen String für den Ähnlichkeitsvergleich. */
export function normalizeForScoring(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrahiert die erste Hausnummer aus einem normalisierten String. */
export function extractHouseNumber(value: string): string | null {
  const match = value.match(/\b(\d+[a-z]?)\b/);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Entfernt die Hausnummer aus einer Adress-Query. */
function stripHouseNumber(query: string): string {
  return query
    .replace(/^(\d+[a-z]?)\s+/, "")        // "12 Musterstraße" -> "Musterstraße"
    .replace(/\s+\d+[a-z]?(?=\s|,|$)/g, "") // "Musterstraße 12" -> "Musterstraße"
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Geocode-Search                                                      */
/* ------------------------------------------------------------------ */

/** Interne Struktur eines ORS-Features. */
type OrsFeature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    label?: string;
    name?: string;
    match_type?: string;
    accuracy?: string;
  };
};

/** Kandidat mit Score. */
type Candidate = OrsGeocodeHit & { score: number };

/** Extrahiert Kandidaten aus einer ORS-Antwort. */
function extractCandidates(
  features: OrsFeature[],
  queryTokens: string[],
  queryHouseNumber: string | null,
  boundary?: OrsBoundaryRect,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const feature of features) {
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
      continue;
    }

    // Fallback/Centroid-Ergebnisse ablehnen
    const matchType = feature?.properties?.match_type;
    const accuracy = feature?.properties?.accuracy;
    if (matchType === "fallback" || accuracy === "centroid") {
      continue;
    }

    // Clientseitige Boundary-Filterung
    if (boundary) {
      const inside =
        lng >= boundary.minLon &&
        lng <= boundary.maxLon &&
        lat >= boundary.minLat &&
        lat <= boundary.maxLat;
      if (!inside) continue;
    }

    // Ähnlichkeitsscore
    const normLabel = normalizeForScoring(
      label.toLowerCase().replace(/\bdeutschland\b/i, ""),
    );
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
    candidates.push({
      label: cleanAddressLabel(label),
      name: feature?.properties?.name?.trim() ?? "",
      latitude: lat,
      longitude: lng,
      score,
    });
  }

  return candidates;
}

/** Führt eine einzelne ORS-Geocode-Search aus. */
async function searchOnce(query: string): Promise<OrsFeature[]> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = new URL("https://api.openrouteservice.org/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("size", "5");
    url.searchParams.set("lang", "de");
    url.searchParams.set("boundary.country", "DEU");

    const res = await fetch(url, {
      headers: { Authorization: orsAuthorizationHeader(apiKey) },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json: { features?: OrsFeature[] } = await res.json();
    return json.features ?? [];
  } catch {
    return [];
  }
}

/**
 * ORS-Geocode-Search (vollständige Adresssuche, DEU-begrenzt) und liefert
 * den besten Treffer mit Label + Koordinaten. null bei Fehler/kein Key.
 * Über `options.boundary` kann die Suche auf ein Rechteck begrenzt werden
 * (z. B. Würzburg, wenn die Adresse geraten werden muss).
 *
 * Die Rechteck-Filterung erfolgt rein clientseitig (der ORS-Free-Plan
 * unterstützt `boundary.rect` nicht). Treffer außerhalb des Rechtecks
 * sowie Fallback-/Centroid-Ergebnisse (ORS hat keine Straßendaten)
 * werden verworfen.
 *
 * Two-Pass-Fallback: Wenn die exakte Suche keinen Treffer liefert, wird ein
 * zweiter Versuch ohne Hausnummer gestartet. So werden kleine Fehler in der
 * Hausnummer automatisch abgefangen.
 */
export async function orsGeocodeSearch(
  query: string,
  options?: { boundary?: OrsBoundaryRect },
): Promise<OrsGeocodeHit | null> {
  const normQuery = normalizeForScoring(query);
  const queryTokens = normQuery.split(/\s+/).filter(Boolean);
  const queryHouseNumber = extractHouseNumber(normQuery);
  const boundary = options?.boundary;

  // Pass 1: Exakte Query
  const features1 = await searchOnce(query);
  const candidates1 = extractCandidates(
    features1,
    queryTokens,
    queryHouseNumber,
    boundary,
  );
  if (candidates1.length > 0) {
    candidates1.sort((a, b) => b.score - a.score);
    return {
      label: candidates1[0].label,
      name: candidates1[0].name,
      latitude: candidates1[0].latitude,
      longitude: candidates1[0].longitude,
    };
  }

  // Pass 2: Ohne Hausnummer (fängt Fehler wie falsche/fehlende Hausnummer ab)
  if (queryHouseNumber !== null) {
    const stripped = stripHouseNumber(query);
    if (stripped.length >= 3 && stripped !== query) {
      const features2 = await searchOnce(stripped);
      const tokens2 = normalizeForScoring(stripped)
        .split(/\s+/)
        .filter(Boolean);
      const candidates2 = extractCandidates(
        features2,
        tokens2,
        null, // keine Hausnummer beim Scoring
        boundary,
      );
      if (candidates2.length > 0) {
        candidates2.sort((a, b) => b.score - a.score);
        return {
          label: candidates2[0].label,
          name: candidates2[0].name,
          latitude: candidates2[0].latitude,
          longitude: candidates2[0].longitude,
        };
      }
    }
  }

  return null;
}
