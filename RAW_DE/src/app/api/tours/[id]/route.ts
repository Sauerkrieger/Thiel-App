import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveredItems, parseDeliveryItems } from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";
import { checkLww } from "@/lib/lww";
import { lwwConflictResponse } from "@/lib/http";
import type { Database } from "@/types/database";
import { orsGeocodeSearch, normalizeAddressForGeocoding } from "@/lib/ors";
import { photonGeocodeSearch } from "@/lib/photon";
import { WAREHOUSE_NAME, WAREHOUSE_ADDRESS } from "@/lib/warehouse";
import type { TourStatus } from "@/types/database";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const TOUR_STATUSES: readonly TourStatus[] = [
  "packing",
  "in_transit",
  "completed",
];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lager-Koordinaten für die Kartenanzeige (einmal pro Prozess geocodiert). */
type WarehouseCoords = {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

let cachedWarehouse: WarehouseCoords | null = null;
let warehousePromise: Promise<WarehouseCoords | null> | null = null;

async function resolveWarehouse(): Promise<WarehouseCoords | null> {
  if (cachedWarehouse) return cachedWarehouse;
  if (!warehousePromise) {
    warehousePromise = (async () => {
      const hit = await orsGeocodeSearch(WAREHOUSE_ADDRESS);
      if (!hit) return null;
      const resolved = {
        name: WAREHOUSE_NAME,
        address: WAREHOUSE_ADDRESS,
        latitude: hit.latitude,
        longitude: hit.longitude,
      };
      cachedWarehouse = resolved;
      return resolved;
    })().finally(() => {
      // Fehlgeschlagene Auflösung nicht dauerhaft cachen (nächster Aufruf versucht es erneut)
      warehousePromise = null;
    });
  }
  return warehousePromise;
}

/** Prüft, ob der angemeldete Nutzer die Tour sehen/bearbeiten darf (Besitzer oder Admin). */
async function assertTourAccess(id: string, userId: string, isAdminUser: boolean) {
  if (isAdminUser) return true;
  const supabase = getSupabaseAdmin();
  const { data: tour, error } = await supabase
    .from("active_tours")
    .select("driver_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!tour) return false;
  return tour.driver_id === userId;
}

/**
 * Koordinaten-Backfill für die Tour-Karte: Objekte der Tour ohne Koordinaten
 * werden einmalig über die Adresse geocodet und in der DB persistiert.
 * Damit zeigt die Karte im Tour-Modus (Ausfahren) alle Ziele – auch wenn sie
 * beim Speichern des Objekts noch nicht geocodet wurden.
 *
 * Läuft parallel (alle fehlenden Objekte gleichzeitig) und mit Gesamt-Timeout
 * (3 s): Nur Objekte mit echtem Geocoding-Treffer werden in dieser Antwort
 * angereichert, alle Treffer werden persistiert. Schläft das Netz/Geocoding,
 * antwortet der Endpunkt trotzdem spätestens nach dem Timeout (dann ohne
 * Anreicherung – der nächste Aufruf hat die persistierten Koordinaten).
 */
const BACKFILL_TIMEOUT_MS = 3_000;

async function backfillStopObjectCoordinates(
  stops: unknown[],
): Promise<void> {
  const missing = stops
    .map((stop) => (stop as { object?: unknown }).object)
    .filter(
      (obj): obj is { id: string; address: string; latitude: number | null; longitude: number | null } =>
        Boolean(obj) &&
        typeof (obj as { id?: unknown }).id === "string" &&
        typeof (obj as { address?: unknown }).address === "string" &&
        !(
          typeof (obj as { latitude?: unknown }).latitude === "number" &&
          typeof (obj as { longitude?: unknown }).longitude === "number"
        ),
    );
  if (missing.length === 0) return;

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), BACKFILL_TIMEOUT_MS),
  );

  const work = (async () => {
    const supabase = getSupabaseAdmin();
    await Promise.all(
      missing.map(async (obj) => {
        const normalized = normalizeAddressForGeocoding(obj.address);
        // Reihenfolge wie im Optimierer: Photon (fuzzy) → ORS (exakt).
        const hit =
          (await photonGeocodeSearch(normalized)) ??
          (await orsGeocodeSearch(normalized));
        if (!hit) return;
        const { error } = await supabase
          .from("objects")
          .update({ latitude: hit.latitude, longitude: hit.longitude })
          .eq("id", obj.id);
        if (!error) {
          // Antwortobjekt anreichern, damit diese Antwort die Koordinaten
          // bereits enthält (Karte sofort vollständig).
          obj.latitude = hit.latitude;
          obj.longitude = hit.longitude;
        }
      }),
    );
  })();

  try {
    await Promise.race([work, timeout]);
  } catch {
    /* Backfill darf den Tour-Ladevorgang nie blockieren */
  }
}

export async function GET(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const allowed = await assertTourAccess(id, auth.user.id, isAdmin(auth.user));
    if (!allowed) {
      return NextResponse.json(
        { error: "Tour nicht gefunden." },
        { status: 404 },
      );
    }
    const { data, error } = await supabase
      .from("active_tours")
      .select(
        "*, tour_stops(*, object:objects(id, name, address, category, latitude, longitude, remark))",
      )
      .eq("id", id)
      .order("stop_order", { referencedTable: "tour_stops" })
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Tour nicht gefunden." },
          { status: 404 },
        );
      }
      throw error;
    }
    // next_delivery_items normalisieren (Legacy: Strings, neu: { item_name, note })
    const raw = data as unknown as {
      tour_stops?: Array<{
        next_delivery_items?: unknown;
        [key: string]: unknown;
      }>;
    };
    const tour = {
      ...raw,
      tour_stops: (raw.tour_stops ?? []).map((stop) => ({
        ...stop,
        next_delivery_items: parseDeliveryItems(stop.next_delivery_items),
        delivered_items: parseDeliveredItems(stop.delivered_items),
      })),
    };
    // Karte im Tour-Modus vollständig halten: Objekte ohne Koordinaten
    // geocoden (begrenzt auf 3 s, persistiert für künftige Requests).
    await backfillStopObjectCoordinates(tour.tour_stops);
    return NextResponse.json({ tour: { ...tour, warehouse: await resolveWarehouse() } });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

/** PATCH /api/tours/[id] -> Status der Tour ändern (z. B. completed). */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body.status as unknown;
    const startTime = body.start_time as unknown;

    if (!TOUR_STATUSES.includes(status as TourStatus)) {
      return NextResponse.json(
        { error: "Ungültiger Tour-Status." },
        { status: 400 },
      );
    }
    if (startTime !== undefined && (typeof startTime !== "string" || !TIME_PATTERN.test(startTime))) {
      return NextResponse.json(
        { error: "Ungültige Startzeit (Format HH:MM erwartet)." },
        { status: 400 },
      );
    }

    const allowed = await assertTourAccess(id, auth.user.id, isAdmin(auth.user));
    if (!allowed) {
      return NextResponse.json(
        { error: "Tour nicht gefunden." },
        { status: 404 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Die Last-Delivery-Aktualisierung und das Verbrauchen der Vormerkungen
    // erfolgen per Datenbank-Trigger genau beim Statusübergang bzw. der
    // erfolgreichen Belieferung. So funktioniert es auch über den Offline-Sync.

    const lww = await checkLww(
      supabase,
      "active_tours",
      id,
      body.client_updated_at,
    );
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
    }

    const updatePayload: Database["public"]["Tables"]["active_tours"]["Update"] = {
      status: status as TourStatus,
    };
    if (typeof startTime === "string") {
      updatePayload.start_time = startTime;
    }
    if (lww.status === "apply") {
      updatePayload.client_updated_at = lww.clientUpdatedAt;
    }
    updatePayload.synced_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("active_tours")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Tour nicht gefunden." },
          { status: 404 },
        );
      }
      throw error;
    }
    return NextResponse.json({ tour: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

/**
 * DELETE /api/tours/[id] -> Tour (inkl. Stopps per Cascade) löschen.
 * Admins dürfen alles löschen; Fahrer/Springer dürfen ihre eigene, noch
 * nicht abgeschlossene Tour löschen (z. B. das „Laufende Tour“-Fenster).
 */
export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from("active_tours")
      .select("driver_id, status")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Tour nicht gefunden." }, { status: 404 });
    }

    const isOwner = existing.driver_id === auth.user.id;
    if (!isAdmin(auth.user)) {
      if (!isOwner) {
        return NextResponse.json(
          { error: "Nur Admins oder der Fahrer der Tour dürfen Touren löschen." },
          { status: 403 },
        );
      }
      if (existing.status === "completed") {
        return NextResponse.json(
          { error: "Abgeschlossene Touren können nur Admins löschen." },
          { status: 403 },
        );
      }
    }

    const { error } = await supabase
      .from("active_tours")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
