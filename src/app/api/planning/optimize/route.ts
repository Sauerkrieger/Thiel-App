import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { optimizeRoute } from "@/lib/routing/optimizer";
import { requireUser, isPlanner } from "@/lib/auth";
import type { RouteObject } from "@/lib/routing/optimizer";

export const dynamic = "force-dynamic";

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
      { error: "Nur Fahrer und Admins dürfen Touren planen." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const objectIds = body.object_ids;
    const startTime = body.start_time;

    if (
      !Array.isArray(objectIds) ||
      objectIds.length === 0 ||
      objectIds.some((id) => typeof id !== "string")
    ) {
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
    const { data: objects, error } = await supabase
      .from("objects")
      .select(
        "id, name, address, category, is_pedestrian_zone_until_11, key_number, opens_at, remark",
      )
      .in("id", objectIds as string[]);

    if (error) throw error;
    if (!objects || objects.length === 0) {
      return NextResponse.json(
        { error: "Keine Objekte gefunden." },
        { status: 404 },
      );
    }

    const routeObjects: RouteObject[] = (objects as RouteObject[]).map(
      (obj) => ({
        id: obj.id,
        name: obj.name,
        address: obj.address,
        category: obj.category,
        is_pedestrian_zone_until_11: obj.is_pedestrian_zone_until_11,
        key_number: obj.key_number,
        opens_at: obj.opens_at,
        remark: obj.remark ?? null,
      }),
    );

    const result = await optimizeRoute(routeObjects, startTime ?? undefined);
    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
