import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { orsAuthorizationHeader } from "@/lib/ors";
import { decodePolyline } from "@/lib/polyline";
import { requireUser, isPlanner } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Max. Punkte für eine Directions-Anfrage (50 Objekte + Lager + Rückfahrt). */
const MAX_POINTS = 102;

type Coord = [number, number];

/**
 * POST /api/planning/route-geometry
 *
 * Berechnet den Straßenverlauf (ORS Directions, driving-car) für eine
 * geordnete Koordinatenliste (Rundtour: Lager -> Stopps -> Lager) und
 * liefert die Geometrie als [lng, lat]-Paare für die Karte (Leaflet).
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isPlanner(auth.user)) {
    return NextResponse.json(
      { error: "Nur Fahrer und Admins dürfen Routen auf der Karte anzeigen." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const coordinates = body.coordinates as unknown;

    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      coordinates.length > MAX_POINTS
    ) {
      return NextResponse.json(
        { error: "Ungültige Koordinatenliste (2–102 Punkte erwartet)." },
        { status: 400 },
      );
    }

    const points: Coord[] = [];
    for (const raw of coordinates) {
      if (
        !Array.isArray(raw) ||
        raw.length < 2 ||
        typeof raw[0] !== "number" ||
        typeof raw[1] !== "number" ||
        !Number.isFinite(raw[0]) ||
        !Number.isFinite(raw[1])
      ) {
        return NextResponse.json(
          { error: "Ungültige Koordinate im Request." },
          { status: 400 },
        );
      }
      points.push([raw[0], raw[1]]);
    }

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Kein ORS_API_KEY konfiguriert – Karte ohne Straßenverlauf.", code: "ORS_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const res = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: orsAuthorizationHeader(apiKey),
        },
        body: JSON.stringify({
          coordinates: points,
          geometry: true,
          instructions: false,
          units: "m",
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) {
      console.error(
        `[Geometry] ORS-Directions fehlgeschlagen (Status ${res.status}):`,
        await res.text().catch(() => ""),
      );
      return NextResponse.json(
        { error: "ORS-Routenberechnung fehlgeschlagen." },
        { status: 502 },
      );
    }

    const json = await res.json();
    const route = json?.routes?.[0];
    const encoded = route?.geometry;
    if (typeof encoded !== "string" || encoded.length === 0) {
      console.error("[Geometry] ORS-Antwort ohne Geometrie:", json);
      return NextResponse.json(
        { error: "ORS lieferte keine Routengeometrie." },
        { status: 502 },
      );
    }

    const decoded = decodePolyline(encoded);
    if (!decoded || decoded.length < 2) {
      return NextResponse.json(
        { error: "Routengeometrie konnte nicht dekodiert werden." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      coordinates: decoded,
      distance_m: Math.round(route?.summary?.distance ?? 0),
      duration_s: Math.round(route?.summary?.duration ?? 0),
    });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
