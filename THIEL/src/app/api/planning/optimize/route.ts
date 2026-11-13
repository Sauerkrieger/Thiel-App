import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { optimizeRoute } from "@/lib/routing/optimizer";
import { requireUser, isPlanner } from "@/lib/auth";
import type { RouteObject } from "@/lib/routing/optimizer";

export const dynamic = "force-dynamic";

// Die Berechnung kann mit vielen Objekten länger als die Standard-10s
// (Vercel Hobby) dauern – besonders wenn externe APIs (ORS/TomTom) langsam
// sind. Mit gespeicherten Koordinaten ist sie zwar meist < 1s, das erhöhte
// Limit schützt aber vor Timeouts (504) bei großen Touren.
export const maxDuration = 60;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
      { error: "Nur Fahrer, Springer und Admins dürfen Touren planen." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const objectIds = body.object_ids;
    const unknownTargets = body.unknown_targets;
    const startTime = body.start_time;

    if (
      !Array.isArray(objectIds) ||
      objectIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "Ungültige Objektauswahl." },
        { status: 400 },
      );
    }
    if (
      unknownTargets !== undefined &&
      (!Array.isArray(unknownTargets) ||
        unknownTargets.some(
          (target) =>
            !target ||
            typeof target !== "object" ||
            typeof target.id !== "string" ||
            typeof target.name !== "string" ||
            typeof target.address !== "string" ||
            !target.name.trim() ||
            !target.address.trim() ||
            (target.latitude !== undefined && target.latitude !== null && typeof target.latitude !== "number") ||
            (target.longitude !== undefined && target.longitude !== null && typeof target.longitude !== "number"),
        ))
    ) {
      return NextResponse.json(
        { error: "Ungültige unbekannte Ziele." },
        { status: 400 },
      );
    }
    if (objectIds.length === 0 && (!Array.isArray(unknownTargets) || unknownTargets.length === 0)) {
      return NextResponse.json(
        { error: "Bitte mindestens ein Objekt auswählen." },
        { status: 400 },
      );
    }
    if (startTime !== undefined && (typeof startTime !== "string" || !TIME_PATTERN.test(startTime))) {
      return NextResponse.json(
        { error: "Ungültige Startzeit (Format HH:MM erwartet)." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: objects, error } = objectIds.length
      ? await supabase
          .from("objects")
          .select(
            "id, name, address, category, is_pedestrian_zone_until_11, key_number, opens_at, remark, latitude, longitude",
          )
          .in("id", objectIds as string[])
      : { data: [], error: null };

    if (error) throw error;
    if ((!objects || objects.length === 0) && (!Array.isArray(unknownTargets) || unknownTargets.length === 0)) {
      return NextResponse.json(
        { error: "Keine Ziele gefunden." },
        { status: 404 },
      );
    }

    const routeObjects: RouteObject[] = [
      ...((objects ?? []) as RouteObject[]).map((obj) => ({
        id: obj.id,
        name: obj.name,
        address: obj.address,
        category: obj.category,
        is_pedestrian_zone_until_11: obj.is_pedestrian_zone_until_11,
        key_number: obj.key_number,
        opens_at: obj.opens_at,
        remark: obj.remark ?? null,
        latitude: obj.latitude ?? null,
        longitude: obj.longitude ?? null,
      })),
      ...((Array.isArray(unknownTargets) ? unknownTargets : []) as Array<{
        id: string;
        name: string;
        address: string;
        latitude?: number | null;
        longitude?: number | null;
      }>).map((target) => ({
        id: `unknown:${target.id}`,
        is_unknown: true,
        unknown_target_id: target.id,
        name: target.name.trim(),
        address: target.address.trim(),
        category: "objekt" as const,
        is_pedestrian_zone_until_11: false,
        key_number: null,
        opens_at: null,
        remark: null,
        // Aus der Vorschlags-Auswahl verifizierte Koordinaten direkt
        // übernehmen – die Berechnung muss die Adresse dann nicht erneut
        // geocoden (schnellere Routenberechnung, weniger API-Aufrufe).
        latitude: typeof target.latitude === "number" ? target.latitude : null,
        longitude: typeof target.longitude === "number" ? target.longitude : null,
      })),
    ];

    const result = await optimizeRoute(routeObjects, startTime ?? undefined);
    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
