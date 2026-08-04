import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isPlanner } from "@/lib/auth";
import { parseClientUpdatedAt } from "@/lib/lww";
import type { Database, DayOfWeek } from "@/types/database";

export const dynamic = "force-dynamic";

/** GET /api/planning?day_of_week=1 -> Objekte + gespeicherte Vorauswahl des Nutzers. */
export async function GET(request: NextRequest) {
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
    const dayParam = request.nextUrl.searchParams.get("day_of_week");
    const day = Number.parseInt(dayParam ?? "", 10);
    if (Number.isNaN(day) || day < 0 || day > 6) {
      return NextResponse.json(
        { error: "Ungültiger Wochentag (0-6 erwartet)." },
        { status: 400 },
      );
    }
    const dayOfWeek = day as DayOfWeek;

    const supabase = getSupabaseAdmin();
    const [objectsResult, defaultsResult] = await Promise.all([
      supabase
        .from("objects")
        .select(
          "id, name, address, category, is_pedestrian_zone_until_11, opens_at, remark",
        )
        .order("name"),
      supabase
        .from("weekly_default_routes")
        .select("object_id, selection_order, updated_at")
        .eq("user_id", auth.user.id)
        .eq("day_of_week", dayOfWeek)
        .order("selection_order"),
    ]);

    if (objectsResult.error) throw objectsResult.error;
    if (defaultsResult.error) throw defaultsResult.error;

    const defaults = defaultsResult.data ?? [];
    const updatedAtValues = defaults
      .map((row) => row.updated_at)
      .filter((value): value is string => typeof value === "string")
      .map((value) => new Date(value).getTime());

    return NextResponse.json({
      day_of_week: dayOfWeek,
      objects: objectsResult.data ?? [],
      selected_ids: defaults.map((row) => row.object_id),
      defaults_updated_at:
        updatedAtValues.length > 0
          ? new Date(Math.max(...updatedAtValues)).toISOString()
          : null,
    });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

/** PUT /api/planning -> Auswahl des Nutzers für den Wochentag transaktional ersetzen. */
export async function PUT(request: Request) {
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
    const day = body.day_of_week;
    const objectIds = body.object_ids;

    if (
      typeof day !== "number" ||
      !Number.isInteger(day) ||
      day < 0 ||
      day > 6
    ) {
      return NextResponse.json(
        { error: "Ungültiger Wochentag (0-6 erwartet)." },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(objectIds) ||
      objectIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "object_ids muss ein Array von Objekt-IDs sein." },
        { status: 400 },
      );
    }

    const uniqueIds = [...new Set(objectIds as string[])];

    const supabase = getSupabaseAdmin();
    // Last-Write-Wins pro Wochentag: Der eingehende client_updated_at wird
    // gegen das Maximum der bestehenden Zeilen des Nutzers verglichen.
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    if (clientUpdatedAt) {
      const { data: existingRows } = await supabase
        .from("weekly_default_routes")
        .select("client_updated_at")
        .eq("user_id", auth.user.id)
        .eq("day_of_week", day as DayOfWeek);
      if (existingRows) {
        const maxExistingMs = existingRows.reduce(
          (max, row) =>
            row.client_updated_at
              ? Math.max(max, Date.parse(row.client_updated_at))
              : max,
          0,
        );
        if (Date.parse(clientUpdatedAt) <= maxExistingMs) {
          // Konflikt: aktuellen Server-Zustand (Auswahl des Tages) zurückmelden
          const { data: current } = await supabase
            .from("weekly_default_routes")
            .select("object_id, selection_order, client_updated_at")
            .eq("user_id", auth.user.id)
            .eq("day_of_week", day as DayOfWeek)
            .order("selection_order");
          const currentUpdatedAt = (current ?? [])
            .map((row) => row.client_updated_at)
            .filter((value): value is string => typeof value === "string")
            .map((value) => new Date(value).getTime());
          return NextResponse.json(
            {
              error: "Die Auswahl wurde auf einem anderen Gerät neuer bearbeitet.",
              code: "CONFLICT",
              serverRecord: {
                day_of_week: day,
                selected_ids: (current ?? []).map((row) => row.object_id),
                defaults_updated_at:
                  currentUpdatedAt.length > 0
                    ? new Date(Math.max(...currentUpdatedAt)).toISOString()
                    : null,
              },
            },
            { status: 409 },
          );
        }
      }
    }

    const { error } = await supabase.rpc("save_weekly_defaults", {
      p_user_id: auth.user.id,
      p_day_of_week: day,
      p_object_ids: uniqueIds,
    });

    if (error) throw error;

    // Zeitstempel der neu erzeugten Zeilen setzen (RPC legt sie ohne an)
    const now = new Date().toISOString();
    const stampPayload: Database["public"]["Tables"]["weekly_default_routes"]["Update"] = {
      synced_at: now,
    };
    if (clientUpdatedAt) {
      stampPayload.client_updated_at = clientUpdatedAt;
      stampPayload.updated_at = clientUpdatedAt;
    }
    const { error: stampError } = await supabase
      .from("weekly_default_routes")
      .update(stampPayload)
      .eq("user_id", auth.user.id)
      .eq("day_of_week", day as DayOfWeek);
    if (stampError) throw stampError;

    return NextResponse.json({ saved: true, count: uniqueIds.length });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
