import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";
import { requireUser, isPlanner, isAdmin } from "@/lib/auth";
import type { TourStatus } from "@/types/database";
import type { TourHistoryItem } from "@/types/api";

export const dynamic = "force-dynamic";

const TOUR_STATUSES: readonly TourStatus[] = [
  "packing",
  "in_transit",
  "completed",
];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type StopInput = {
  object_id?: unknown;
  arrival_time?: unknown;
  next_delivery_items?: unknown;
};

/** GET /api/tours?user_id=xxx -> Tourenhistorie. Fahrer: nur eigene Touren. Admin: alle (optional gefiltert). */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  const user = auth.user;
  const admin = isAdmin(user);

  try {
    const url = new URL(request.url);
    const filterUserId = url.searchParams.get("user_id");

    // Fahrer sehen nur ihre eigenen Touren; Admins alle (optional pro Person).
    let query = getSupabaseAdmin()
      .from("active_tours")
      .select("id, date, status, start_time, driver_id, created_at")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (admin && filterUserId) {
      query = query.eq("driver_id", filterUserId);
    } else if (!admin) {
      query = query.eq("driver_id", user.id);
    }

    const { data: tours, error } = await query;
    if (error) throw error;

    if (!tours || tours.length === 0) {
      return NextResponse.json({ tours: [] });
    }

    // Stopps + Objektnamen für alle Touren laden (separate Queries, da die
    // verschachtelte Relation in den handgeschriebenen Typen nicht existiert).
    const tourIds = tours.map((t) => t.id);
    const { data: stops, error: stopsError } = await getSupabaseAdmin()
      .from("tour_stops")
      .select("tour_id, object_id, is_delivered")
      .in("tour_id", tourIds)
      .order("stop_order");
    if (stopsError) throw stopsError;

    const objectIds = [
      ...new Set((stops ?? []).map((s) => s.object_id)),
    ];
    const { data: objectRows, error: objectsError } = objectIds.length
      ? await getSupabaseAdmin()
          .from("objects")
          .select("id, name")
          .in("id", objectIds)
      : { data: [], error: null };
    if (objectsError) throw objectsError;
    const nameByObjectId = new Map(
      (objectRows ?? []).map((o) => [o.id, o.name]),
    );

    // Fahrernamen (driver_id -> profiles.name) laden.
    const driverIds = [
      ...new Set(
        tours
          .map((t) => t.driver_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const { data: profiles, error: profilesError } = driverIds.length
      ? await getSupabaseAdmin()
          .from("profiles")
          .select("id, name")
          .in("id", driverIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

    const stopsByTour = new Map<string, typeof stops>();
    for (const stop of stops ?? []) {
      const list = stopsByTour.get(stop.tour_id) ?? [];
      list.push(stop);
      stopsByTour.set(stop.tour_id, list);
    }

    const history: TourHistoryItem[] = (tours ?? []).map((tour) => {
      const tourStops = stopsByTour.get(tour.id) ?? [];
      const delivered = tourStops.filter((s) => s.is_delivered);
      return {
        id: tour.id,
        date: tour.date,
        status: tour.status,
        start_time: tour.start_time,
        driver_name: tour.driver_id ? nameById.get(tour.driver_id) ?? null : null,
        delivered_objects: delivered
          .map((s) => nameByObjectId.get(s.object_id))
          .filter((n): n is string => typeof n === "string"),
        delivered_count: delivered.length,
        total_stops: tourStops.length,
      };
    });

    return NextResponse.json({ tours: history });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  // Nur Fahrer und Admins dürfen Touren planen/starten.
  if (!isPlanner(auth.user)) {
    return NextResponse.json(
      { error: "Nur Fahrer und Admins dürfen Touren starten." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const startTime = body.start_time;
    const status = body.status;
    const stops = body.stops as StopInput[] | undefined;

    if (startTime !== undefined && (typeof startTime !== "string" || !TIME_PATTERN.test(startTime))) {
      return NextResponse.json(
        { error: "Ungültige Startzeit (Format HH:MM erwartet)." },
        { status: 400 },
      );
    }
    const tourStatus: TourStatus =
      TOUR_STATUSES.includes(status) ? (status as TourStatus) : "packing";

    if (!Array.isArray(stops) || stops.length === 0) {
      return NextResponse.json(
        { error: "Die Tour benötigt mindestens einen Stopp." },
        { status: 400 },
      );
    }
    const stopInputs = stops
      .map((stop, index) => ({
        object_id: typeof stop.object_id === "string" ? stop.object_id : "",
        arrival_time:
          typeof stop.arrival_time === "string" && TIME_PATTERN.test(stop.arrival_time)
            ? stop.arrival_time
            : null,
        next_delivery_items: parseDeliveryItems(stop.next_delivery_items),
        stop_order: index,
      }))
      .filter((stop) => stop.object_id.length > 0);

    if (stopInputs.length === 0) {
      return NextResponse.json(
        { error: "Die Tour benötigt mindestens einen gültigen Stopp." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);

    const { data: tour, error: tourError } = await supabase
      .from("active_tours")
      .insert({
        date: today,
        status: tourStatus,
        start_time: startTime ?? null,
        driver_id: auth.user.id,
      })
      .select()
      .single();

    if (tourError) throw tourError;

    const { error: stopsError } = await supabase.from("tour_stops").insert(
      stopInputs.map((stop) => ({
        tour_id: tour.id,
        object_id: stop.object_id,
        stop_order: stop.stop_order,
        arrival_time: stop.arrival_time,
        next_delivery_items: stop.next_delivery_items,
      })),
    );

    if (stopsError) {
      // Tour bereinigen, wenn das Anlegen der Stopps fehlschlägt
      await supabase.from("active_tours").delete().eq("id", tour.id);
      throw stopsError;
    }

    return NextResponse.json({ tour }, { status: 201 });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
