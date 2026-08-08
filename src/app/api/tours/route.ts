import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";
import { requireUser, isPlanner, isAdmin } from "@/lib/auth";
import { parseClientUpdatedAt } from "@/lib/lww";
import type { Database } from "@/types/database";
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
  key_number?: unknown;
  next_delivery_items?: unknown;
};

// Stopp-Zeile der Historie. Die „Nicht lieferbar“-Spalten existieren erst nach
// Migration 20260811000000 – die Fallback-Query (ohne Migration) liefert Zeilen
// ohne sie, deshalb sind die neuen Felder optional.
type HistoryStopRow = {
  tour_id: string;
  object_id: string;
  is_delivered: boolean;
  key_number: number | null;
  is_undeliverable?: boolean;
  undeliverable_reason?: string | null;
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
    // Performance: Stopps und Fahrernamen sind voneinander unabhängig und
    // laufen parallel (ein Supabase-Roundtrip weniger).
    const tourIds = tours.map((t) => t.id);
    const driverIds = [
      ...new Set(
        tours
          .map((t) => t.driver_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const profilesPromise: PromiseLike<{
      data: { id: string; name: string }[] | null;
      error: { message: string } | null;
    }> =
      driverIds.length > 0
        ? getSupabaseAdmin()
            .from("profiles")
            .select("id, name")
            .in("id", driverIds)
        : Promise.resolve({ data: null, error: null });
    const stopsQuery = getSupabaseAdmin()
      .from("tour_stops")
      .select("tour_id, object_id, is_delivered, is_undeliverable, undeliverable_reason, key_number")
      .in("tour_id", tourIds)
      .order("stop_order");
    const [stopsResult, profilesResult] = await Promise.all([
      stopsQuery,
      profilesPromise,
    ]);
    let stops: HistoryStopRow[] | null = stopsResult.data;
    let stopsError = stopsResult.error;
    if (
      stopsError &&
      (stopsError.code === "PGRST204" ||
        String(stopsError.message ?? "").includes("is_undeliverable"))
    ) {
      // Migration 20260811000000 noch nicht angewendet → ohne die neuen
      // Spalten lesen („Nicht lieferbar“-Infos fehlen dann bis dahin).
      const fallback = await getSupabaseAdmin()
        .from("tour_stops")
        .select("tour_id, object_id, is_delivered, key_number")
        .in("tour_id", tourIds)
        .order("stop_order");
      stops = fallback.data;
      stopsError = fallback.error;
    }
    if (stopsError) throw stopsError;
    const { data: profiles, error: profilesError } = profilesResult;
    if (profilesError) throw profilesError;
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

    const objectIds = [
      ...new Set((stops ?? []).map((s) => s.object_id)),
    ];
    // Kunden-Infos sind Admin-Daten (wie in der Objektverwaltung) – sie
    // werden in der Historie nur Admins geliefert, nicht an Fahrer/Springer.
    const objectQuery = admin
      ? getSupabaseAdmin()
          .from("objects")
          .select("id, name, address, customer")
      : getSupabaseAdmin()
          .from("objects")
          .select("id, name, address");
    const { data: objectRows, error: objectsError } = objectIds.length
      ? await objectQuery.in("id", objectIds)
      : { data: [], error: null };
    if (objectsError) throw objectsError;
    const nameByObjectId = new Map(
      (objectRows ?? []).map((o) => [o.id, o.name]),
    );
    const addressByObjectId = new Map(
      (objectRows ?? []).map((o) => [o.id, o.address]),
    );
    const customerByObjectId = admin
      ? new Map(
          (objectRows ?? []).map((o) => [
            o.id,
            (o as { customer?: string | null }).customer ?? "",
          ]),
        )
      : new Map<string, string>();

    const stopsByTour = new Map<string, HistoryStopRow[]>();
    for (const stop of stops ?? []) {
      const list = stopsByTour.get(stop.tour_id) ?? [];
      list.push(stop);
      stopsByTour.set(stop.tour_id, list);
    }

    const history: TourHistoryItem[] = (tours ?? []).map((tour) => {
      const tourStops = stopsByTour.get(tour.id) ?? [];
      const delivered = tourStops.filter((s) => s.is_delivered);
      const undeliverable = tourStops.filter((s) => s.is_undeliverable === true);
      return {
        id: tour.id,
        date: tour.date,
        status: tour.status,
        start_time: tour.start_time,
        driver_id: tour.driver_id,
        driver_name: tour.driver_id ? nameById.get(tour.driver_id) ?? null : null,
        delivered_objects: delivered
          .map((s) => nameByObjectId.get(s.object_id))
          .filter((n): n is string => typeof n === "string"),
        delivered_addresses: delivered
          .map((s) => addressByObjectId.get(s.object_id) ?? "")
          .filter((a): a is string => a.length > 0),
        // Kunden nur für Admins (dürfen in der Historie danach suchen).
        delivered_customers: admin
          ? delivered
              .map((s) => customerByObjectId.get(s.object_id) ?? "")
              .filter((c): c is string => c.length > 0)
          : [],
        delivered_count: delivered.length,
        undeliverable_count: undeliverable.length,
        undeliverable: undeliverable.map((s) => ({
          object_name: nameByObjectId.get(s.object_id) ?? "Unbekanntes Objekt",
          reason:
            typeof s.undeliverable_reason === "string"
              ? s.undeliverable_reason
              : null,
        })),
        key_numbers: [...new Set(
          tourStops
            .map((s) => s.key_number)
            .filter((key): key is number => typeof key === "number"),
        )].sort((a, b) => a - b),
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
  // Nur Fahrer, Springer und Admins dürfen Touren planen/starten.
  if (!isPlanner(auth.user)) {
    return NextResponse.json(
      { error: "Nur Fahrer, Springer und Admins dürfen Touren starten." },
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
    const objectIds = stops
      .map((stop) => (typeof stop.object_id === "string" ? stop.object_id : ""))
      .filter((id): id is string => id.length > 0);
    const { data: keyRows, error: keyRowsError } = await getSupabaseAdmin()
      .from("objects")
      .select("id, key_number")
      .in("id", objectIds);
    if (keyRowsError) throw keyRowsError;
    const keyByObjectId = new Map(
      (keyRows ?? []).map((row) => [row.id, row.key_number]),
    );

    const stopInputs = stops
      .map((stop, index) => ({
        object_id: typeof stop.object_id === "string" ? stop.object_id : "",
        arrival_time:
          typeof stop.arrival_time === "string" && TIME_PATTERN.test(stop.arrival_time)
            ? stop.arrival_time
            : null,
        next_delivery_items: parseDeliveryItems(stop.next_delivery_items),
        key_number:
          typeof stop.object_id === "string"
            ? keyByObjectId.get(stop.object_id) ?? null
            : null,
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
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);

    const tourPayload: Database["public"]["Tables"]["active_tours"]["Insert"] = {
      date: today,
      status: tourStatus,
      start_time: startTime ?? null,
      driver_id: auth.user.id,
    };
    if (clientUpdatedAt) {
      tourPayload.created_at = clientUpdatedAt;
      tourPayload.updated_at = clientUpdatedAt;
      tourPayload.client_updated_at = clientUpdatedAt;
    }
    tourPayload.synced_at = new Date().toISOString();

    const { data: tour, error: tourError } = await supabase
      .from("active_tours")
      .insert(tourPayload)
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
        key_number: stop.key_number,
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
