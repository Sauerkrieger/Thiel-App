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

function isMissingWarehouseArrivalColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return /warehouse_arrival.*schema cache|could not find.*warehouse_arrival|column .*warehouse_arrival.*does not exist/i.test(
    error.message ?? "",
  );
}

/**
 * Migration 20260903000000 (unbekannte Ziele) noch nicht im PostgREST-
 * Schema-Cache. Der Fallback unten hält den Tourstart am Laufen, ohne die
 * temporären Ziele zu speichern.
 */
function isMissingUnknownTargetColumns(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  const mentionsUnknownColumn =
    /is_unknown|unknown_target_id|unknown_name|unknown_address|unknown_latitude|unknown_longitude/i.test(message);
  const schemaCacheIssue =
    error.code === "PGRST204" ||
    /schema cache|could not find|does not exist/i.test(message);
  return mentionsUnknownColumn && schemaCacheIssue;
}

type StopInput = {
  object_id?: unknown;
  arrival_time?: unknown;
  key_number?: unknown;
  next_delivery_items?: unknown;
  is_unknown?: unknown;
  unknown_target_id?: unknown;
  unknown_name?: unknown;
  unknown_address?: unknown;
  unknown_latitude?: unknown;
  unknown_longitude?: unknown;
};

// Stopp-Zeile der Historie. Die „Nicht lieferbar“-Spalten existieren erst nach
// Migration 20260811000000 – die Fallback-Query (ohne Migration) liefert Zeilen
// ohne sie, deshalb sind die neuen Felder optional.
type HistoryStopRow = {
  tour_id: string;
  object_id: string | null;
  is_delivered: boolean;
  is_unknown?: boolean;
  unknown_target_id?: string | null;
  unknown_name?: string | null;
  unknown_address?: string | null;
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

    // Nicht abgeschlossene Touren von VORHEUTE automatisch löschen: Zurückkehren
    // zur Tour ist nur am selben Tag sinnvoll. Der Cleanup folgt dem Scope der
    // Query (Fahrer: eigene; Admin: alle bzw. der gefilterten Person).
    const today = new Date().toISOString().slice(0, 10);
    try {
      const staleTours = getSupabaseAdmin()
        .from("active_tours")
        .delete()
        .in("status", ["packing", "in_transit"])
        .lt("date", today);
      if (!admin) {
        staleTours.eq("driver_id", user.id);
      } else if (filterUserId) {
        staleTours.eq("driver_id", filterUserId);
      }
      await staleTours;
    } catch {
      // Bereinigung darf das Laden der Liste nicht blockieren.
    }

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
      .select("tour_id, object_id, is_delivered, is_unknown, unknown_target_id, unknown_name, unknown_address, is_undeliverable, undeliverable_reason, key_number")
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
      ...new Set(
        (stops ?? [])
          .map((s) => s.object_id)
          .filter((id): id is string => typeof id === "string"),
      ),
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
          .filter((s) => s.is_unknown !== true)
          .map((s) => nameByObjectId.get(s.object_id as string))
          .filter((n): n is string => typeof n === "string"),
        delivered_addresses: delivered
          .filter((s) => s.is_unknown !== true)
          .map((s) => addressByObjectId.get(s.object_id as string) ?? "")
          .filter((a): a is string => a.length > 0)
          .concat(
            delivered
              .filter((s) => s.is_unknown === true)
              .map((s) => s.unknown_address ?? "")
              .filter((a): a is string => a.length > 0),
          ),
        // Kunden nur für Admins (dürfen in der Historie danach suchen).
        delivered_customers: admin
          ? delivered
              .filter((s) => s.is_unknown !== true && s.object_id !== null)
              .map((s) => customerByObjectId.get(s.object_id as string) ?? "")
              .filter((c): c is string => c.length > 0)
          : [],
        delivered_count: delivered.length,
        undeliverable_count: undeliverable.length,
        undeliverable: undeliverable.map((s) => ({
          object_name:
            s.is_unknown === true
              ? s.unknown_name ?? "Unbekanntes Ziel"
              : nameByObjectId.get(s.object_id as string) ?? "Unbekanntes Objekt",
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
        unknown_targets: tourStops
          .filter((s) => s.is_unknown === true)
          .map((s) => ({
            name: s.unknown_name ?? "Unbekanntes Ziel",
            address: s.unknown_address ?? "",
            delivered: s.is_delivered,
            undeliverable: s.is_undeliverable === true,
          })),
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
    const warehouseArrival = body.warehouse_arrival;
    const status = body.status;
    const stops = body.stops as StopInput[] | undefined;

    if (startTime !== undefined && (typeof startTime !== "string" || !TIME_PATTERN.test(startTime))) {
      return NextResponse.json(
        { error: "Ungültige Startzeit (Format HH:MM erwartet)." },
        { status: 400 },
      );
    }
    if (warehouseArrival !== undefined && warehouseArrival !== null && (typeof warehouseArrival !== "string" || !TIME_PATTERN.test(warehouseArrival))) {
      return NextResponse.json(
        { error: "Ungültige Lager-Ankunftszeit (Format HH:MM erwartet)." },
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
    const { data: keyRows, error: keyRowsError } = objectIds.length
      ? await getSupabaseAdmin()
          .from("objects")
          .select("id, key_number")
          .in("id", objectIds)
      : { data: [], error: null };
    if (keyRowsError) throw keyRowsError;
    const keyByObjectId = new Map(
      (keyRows ?? []).map((row) => [row.id, row.key_number]),
    );

    const stopInputs = stops
      .map((stop, index) => {
        const isUnknown = stop.is_unknown === true;
        const objectId = typeof stop.object_id === "string" ? stop.object_id : null;
        const unknownName = typeof stop.unknown_name === "string" ? stop.unknown_name.trim().slice(0, 200) : null;
        const unknownAddress = typeof stop.unknown_address === "string" ? stop.unknown_address.trim().slice(0, 300) : null;
        const unknownTargetId = typeof stop.unknown_target_id === "string" ? stop.unknown_target_id.trim().slice(0, 100) : null;
        const latitude = typeof stop.unknown_latitude === "number" && Number.isFinite(stop.unknown_latitude) ? stop.unknown_latitude : null;
        const longitude = typeof stop.unknown_longitude === "number" && Number.isFinite(stop.unknown_longitude) ? stop.unknown_longitude : null;
        const selectedKey = typeof stop.key_number === "number" && keyByObjectId.get(objectId ?? "") === stop.key_number
          ? stop.key_number
          : null;
        return {
          object_id: isUnknown ? null : objectId,
          is_unknown: isUnknown,
          unknown_target_id: isUnknown ? unknownTargetId : null,
          unknown_name: isUnknown ? unknownName : null,
          unknown_address: isUnknown ? unknownAddress : null,
          unknown_latitude: isUnknown ? latitude : null,
          unknown_longitude: isUnknown ? longitude : null,
          arrival_time:
            typeof stop.arrival_time === "string" && TIME_PATTERN.test(stop.arrival_time)
              ? stop.arrival_time
              : null,
          next_delivery_items: parseDeliveryItems(stop.next_delivery_items),
          key_number: isUnknown ? null : selectedKey,
          stop_order: index,
        };
      })
      .filter((stop) => stop.is_unknown ? Boolean(stop.unknown_target_id && stop.unknown_name && stop.unknown_address) : Boolean(stop.object_id));

    if (stopInputs.length === 0) {
      return NextResponse.json(
        { error: "Die Tour benötigt mindestens einen gültigen Stopp." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Eine neue Tour ersetzt die bisherige laufende Tour desselben Fahrers
    // (packing oder in_transit) – alte Touren werden automatisch gelöscht.
    await supabase
      .from("active_tours")
      .delete()
      .eq("driver_id", auth.user.id)
      .in("status", ["packing", "in_transit"]);

    const today = new Date().toISOString().slice(0, 10);
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);

    const tourPayload: Database["public"]["Tables"]["active_tours"]["Insert"] = {
      date: today,
      status: tourStatus,
      start_time: startTime ?? null,
      warehouse_arrival:
        typeof warehouseArrival === "string" ? warehouseArrival : null,
      driver_id: auth.user.id,
    };
    if (clientUpdatedAt) {
      tourPayload.created_at = clientUpdatedAt;
      tourPayload.updated_at = clientUpdatedAt;
      tourPayload.client_updated_at = clientUpdatedAt;
    }
    tourPayload.synced_at = new Date().toISOString();

    let tourInsert = await supabase
      .from("active_tours")
      .insert(tourPayload)
      .select()
      .single();

    // Kompatibilität für eine bereits laufende Instanz, deren PostgREST-
    // Schema-Cache die Migration noch nicht kennt. Die Migration repariert
    // die Ursache dauerhaft; der Fallback verhindert bis dahin den Abbruch
    // des Tourstarts (die Rückkehrzeit wird dann erst nach dem Schema-Reload
    // gespeichert).
    if (isMissingWarehouseArrivalColumn(tourInsert.error)) {
      const { warehouse_arrival: _warehouseArrival, ...legacyPayload } = tourPayload;
      tourInsert = await supabase
        .from("active_tours")
        .insert(legacyPayload)
        .select()
        .single();
    }

    const { data: tour, error: tourError } = tourInsert;
    if (tourError) throw tourError;

    // Stopps mit ihren IDs zurückgeben, damit der Client beim Start die
    // Ankunftszeiten an den tatsächlichen Start anpassen kann.
    const stopRows = stopInputs.map((stop) => ({
      tour_id: tour.id,
      object_id: stop.object_id,
      stop_order: stop.stop_order,
      arrival_time: stop.arrival_time,
      next_delivery_items: stop.next_delivery_items,
      key_number: stop.key_number,
      is_unknown: stop.is_unknown,
      unknown_target_id: stop.unknown_target_id,
      unknown_name: stop.unknown_name,
      unknown_address: stop.unknown_address,
      unknown_latitude: stop.unknown_latitude,
      unknown_longitude: stop.unknown_longitude,
    }));

    let stopsResult = await supabase
      .from("tour_stops")
      .insert(stopRows)
      .select("id, arrival_time");

    if (stopsResult.error && isMissingUnknownTargetColumns(stopsResult.error)) {
      // Migration 20260903000000 noch nicht angewendet (bzw. Schema-Cache
      // noch nicht aktualisiert): Ohne die neuen Spalten erneut versuchen,
      // damit der Tourstart nicht abbricht. Temporäre Ziele können dabei
      // nicht gespeichert werden – sie werden für diese Tour weggelassen.
      // Die Migration repariert die Ursache dauerhaft.
      const legacyRows = stopRows
        .filter((row) => !row.is_unknown)
        .map((row) => ({
          tour_id: row.tour_id,
          object_id: row.object_id,
          stop_order: row.stop_order,
          arrival_time: row.arrival_time,
          next_delivery_items: row.next_delivery_items,
          key_number: row.key_number,
        }));
      if (legacyRows.length === 0) {
        await supabase.from("active_tours").delete().eq("id", tour.id);
        return NextResponse.json(
          {
            error:
              "Unbekannte Ziele benötigen das Datenbank-Update (Migration 20260903000000). Bitte zuerst ausführen – der Tourstart wurde abgebrochen.",
          },
          { status: 409 },
        );
      }
      stopsResult = await supabase
        .from("tour_stops")
        .insert(legacyRows)
        .select("id, arrival_time");
    }

    if (stopsResult.error) {
      // Tour bereinigen, wenn das Anlegen der Stopps fehlschlägt
      await supabase.from("active_tours").delete().eq("id", tour.id);
      throw stopsResult.error;
    }

    return NextResponse.json(
      { tour, stops: stopsResult.data ?? [] },
      { status: 201 },
    );
  } catch (e) {
    return apiErrorResponse(e);
  }
}
