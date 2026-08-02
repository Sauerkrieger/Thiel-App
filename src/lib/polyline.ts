/**
 * Decoder für Google-Encoded-Polylines, wie sie die ORS-Directions-API im
 * `routes[].geometry`-Feld liefert (Standard-Polyline-Format).
 *
 * ORS verwendet die gleiche Koordinaten-Reihenfolge wie in der Anfrage,
 * also [lng, lat]. Für Leaflet müssen die Paare später auf [lat, lng]
 * gespiegelt werden.
 *
 * @returns Liste von [lng, lat]-Paaren oder null bei ungültigem Input.
 */
export function decodePolyline(encoded: string): [number, number][] | null {
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 0x3f) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 0x3f) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push([lng * 1e-5, lat * 1e-5]);
  }
  return points;
}
