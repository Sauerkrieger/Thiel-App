/**
 * OpenStreetMap-Erkennung via Overpass API (kostenlos, kein API-Key nötig).
 *
 * Wird verwendet für:
 *   - Fußgängerzonen-Erkennung: Liegt eine Koordinate in einer
 *     Fußgängerzone (highway=pedestrian / area:highway=pedestrian)?
 *   - Befahrbaren Haltepunkt: Nächstgelegener Punkt auf einer
 *     befahrbaren Straße außerhalb der Fußgängerzone.
 */

/** Primärer Endpoint + Fallback-Spiegel (bei Überlastung/Rate-Limit). */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 20_000;

/**
 * Overpass-api.de blockt Requests ohne aussagekräftigen User-Agent mit
 * HTTP 406 („Not Acceptable“). Ohne eigenen Header sendet Node/undici den
 * Default-Wert, der abgelehnt wird – daher explizit setzen.
 */
const OVERPASS_USER_AGENT =
  "Thiel-App/1.0 (Routenplanung; +https://github.com/Sauerkrieger/Thiel-App)";

export type Coordinate = { lat: number; lng: number };

/** Befahrbarer Haltepunkt nahe einer Koordinate (Luftlinie). */
export type DrivablePoint = Coordinate & { distance_meters: number };

/** Straßenklassen, die mit dem Fahrzeug befahrbar sind (keine Fußwege/Wege). */
const DRIVABLE_HIGHWAYS = [
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
];

async function queryOverpass(query: string): Promise<{ elements?: unknown[] }> {
  // Überlastung/Rate-Limit (429/5xx) und Timeouts: je Endpoint 2 Versuche,
  // danach auf den Fallback-Spiegel wechseln.
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": OVERPASS_USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });
        if (res.ok) {
          return (await res.json()) as { elements?: unknown[] };
        }
        if (res.status === 429 || res.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        // 4xx (z. B. Syntaxfehler) – kein Retry sinnvoll
        return { elements: [] };
      } catch {
        // Timeout/Netzwerkfehler – nächster Versuch
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return { elements: [] };
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Koordinaten aus einem Overpass-Way (Geometry-Array) extrahieren. */
function wayCoordinates(way: unknown): Coordinate[] {
  if (typeof way !== "object" || way === null) return [];
  const geometry = (way as { geometry?: unknown }).geometry;
  if (!Array.isArray(geometry)) return [];
  const coords: Coordinate[] = [];
  for (const node of geometry) {
    if (typeof node !== "object" || node === null) continue;
    const lat = (node as { lat?: unknown }).lat;
    const lng = (node as { lon?: unknown }).lon;
    if (isNumber(lat) && isNumber(lng)) coords.push({ lat, lng });
  }
  return coords;
}

/** Punkt-in-Polygon-Test (Ray-Casting) für eine geschlossene Fläche. */
function pointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function haversineMeters(a: Coordinate, b: Coordinate): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Abstand Punkt → Streckensegment (in Metern). */
function distanceToSegment(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return haversineMeters(point, {
    lng: a.lng + t * dx,
    lat: a.lat + t * dy,
  });
}

/** Mindestabstand einer Koordinate zu einem Way (in Metern). */
function distanceToWay(point: Coordinate, way: Coordinate[]): number {
  if (way.length < 2) {
    return way.length === 1 ? haversineMeters(point, way[0]) : Number.POSITIVE_INFINITY;
  }
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < way.length - 1; i++) {
    min = Math.min(min, distanceToSegment(point, way[i], way[i + 1]));
  }
  // Geschlossene Polygone: letztes Segment (Ende → Start)
  if (way.length > 2) {
    min = Math.min(min, distanceToSegment(point, way[way.length - 1], way[0]));
  }
  return min;
}

/**
 * Erkennt, ob eine Koordinate in einer Fußgängerzone liegt.
 * Prüft geschlossene Fußgängerzonen-Flächen (Polygon) und offene
 * Fußgängerzonen/-Straßen (Abstand < 40 m zu highway=pedestrian).
 */
export async function isInPedestrianZone(
  coordinate: Coordinate,
): Promise<boolean> {
  const query = `
[out:json][timeout:15];
(
  way(around:200,${coordinate.lat},${coordinate.lng})["highway"="pedestrian"];
  way(around:200,${coordinate.lat},${coordinate.lng})["area:highway"="pedestrian"];
);
out geom;`;

  const data = await queryOverpass(query);
  const ways = (data.elements ?? []).filter(
    (el): el is Record<string, unknown> => typeof el === "object" && el !== null,
  );

  for (const way of ways) {
    const coords = wayCoordinates(way);
    if (coords.length < 2) continue;
    const closed =
      coords.length > 2 &&
      coords[0].lat === coords[coords.length - 1].lat &&
      coords[0].lng === coords[coords.length - 1].lng;
    if (closed) {
      // Geschlossene Fläche → nur Punkt-in-Polygon (Nähe zählt nicht,
      // sonst würde ein Punkt direkt außerhalb fälschlich erkannt)
      if (pointInPolygon(coordinate, coords)) return true;
    } else if (distanceToWay(coordinate, coords) < 40) {
      // Offene Fußgängerzone/-straße → nahe genug
      return true;
    }
  }
  return false;
}

/**
 * Sicherer Fußgängerzonen-Check für den Server: liefert false bei fehlenden
 * Koordinaten oder wenn Overpass nicht erreichbar ist (kein Throw nach außen).
 */
export async function safeIsInPedestrianZone(
  lat: number | null,
  lng: number | null,
): Promise<boolean> {
  if (lat === null || lng === null) return false;
  try {
    return await isInPedestrianZone({ lat, lng });
  } catch {
    // Kein Crash, aber sichtbar machen: Das Objekt wird dann ohne
    // Fußgängerzonen-Kennzeichnung gespeichert.
    console.warn(
      "[Overpass] Fußgängerzonen-Check fehlgeschlagen – Objekt wird ohne Kennzeichnung gespeichert.",
    );
    return false;
  }
}

/**
 * Findet den nächstgelegenen befahrbaren Punkt (auf einer fahrbaren Straße)
 * in einem Umkreis von bis zu `maxRadiusMeters`. Liefert null, wenn nichts
 * gefunden wird (z. B. Overpass nicht erreichbar oder keine Straße).
 */
export async function findNearestDrivablePoint(
  coordinate: Coordinate,
  maxRadiusMeters = 800,
): Promise<DrivablePoint | null> {
  const highwayRegex = DRIVABLE_HIGHWAYS.join("|");
  const query = `
[out:json][timeout:20];
(
  way(around:${maxRadiusMeters},${coordinate.lat},${coordinate.lng})["highway"~"^(${highwayRegex})$"];
);
out geom;`;

  const data = await queryOverpass(query);
  const ways = (data.elements ?? []).filter(
    (el): el is Record<string, unknown> => typeof el === "object" && el !== null,
  );

  let best: DrivablePoint | null = null;
  for (const way of ways) {
    const coords = wayCoordinates(way);
    if (coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const dist = distanceToSegment(coordinate, coords[i], coords[i + 1]);
      if (!best || dist < best.distance_meters) {
        best = { ...closestPointOnSegment(coordinate, coords[i], coords[i + 1]), distance_meters: dist };
      }
    }
  }
  return best;
}

/** Nächster Punkt auf einem Segment (linear interpoliert). */
function closestPointOnSegment(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): Coordinate {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { lng: a.lng + t * dx, lat: a.lat + t * dy };
}
