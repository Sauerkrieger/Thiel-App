import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveredItems, parseDeliveryItems } from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";
import { checkLww } from "@/lib/lww";
import { lwwConflictResponse } from "@/lib/http";
import type { Database } from "@/types/database";
import type { DeliveryItem } from "@/types/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; stopId: string }> };

const MAX_ITEMS = 500;
const MAX_ITEM_LENGTH = 200;
const MAX_NOTE_LENGTH = 300;
const MAX_REASON_LENGTH = 500;

/** PATCH /api/tours/[id]/stops/[stopId] -> is_delivered / is_undeliverable + next_delivery_items. */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id, stopId } = await params;
    const body = await request.json().catch(() => ({}));

    // Nur Besitzer der Tour (oder Admin) darf Stopps bearbeiten.
    const supabase = getSupabaseAdmin();
    const { data: tour, error: tourError } = await supabase
      .from("active_tours")
      .select("driver_id")
      .eq("id", id)
      .maybeSingle();
    if (tourError) throw tourError;
    const isOwner = tour ? tour.driver_id === auth.user.id : false;
    if (!tour || (!isOwner && !isAdmin(auth.user))) {
      return NextResponse.json(
        { error: "Stopp nicht gefunden." },
        { status: 404 },
      );
    }

    const update: {
      is_delivered?: boolean;
      is_undeliverable?: boolean;
      undeliverable_reason?: string | null;
      next_delivery_items?: DeliveryItem[];
      delivered_items?: ReturnType<typeof parseDeliveredItems>;
    } = {};

    // „Beliefert“ und „nicht lieferbar“ schließen sich gegenseitig aus:
    // Echte Belieferung hebt eine „nicht lieferbar“-Markierung auf (und
    // umgekehrt). Beides darf der Client nie gleichzeitig setzen.
    if (typeof body.is_delivered === "boolean") {
      update.is_delivered = body.is_delivered;
      if (body.is_delivered) {
        update.is_undeliverable = false;
        update.undeliverable_reason = null;
      }
    }
    if (body.is_undeliverable === true) {
      update.is_undeliverable = true;
      update.is_delivered = false;
      update.delivered_items = [];
      const reason =
        typeof body.undeliverable_reason === "string"
          ? body.undeliverable_reason.trim().slice(0, MAX_REASON_LENGTH)
          : "";
      update.undeliverable_reason = reason || null;
    } else if (body.is_undeliverable === false) {
      // „Als offen markieren“: Markierung aufheben, Grund nur explizit löschen.
      update.is_undeliverable = false;
      if (body.undeliverable_reason === null) {
        update.undeliverable_reason = null;
      }
    }
    if (
      typeof body.undeliverable_reason === "string" &&
      update.undeliverable_reason === undefined
    ) {
      const reason = body.undeliverable_reason.trim().slice(0, MAX_REASON_LENGTH);
      update.undeliverable_reason = reason || null;
    }
    if (Array.isArray(body.next_delivery_items)) {
      const items = parseDeliveryItems(body.next_delivery_items);
      const tooLong = items.some(
        (item) =>
          item.item_name.length > MAX_ITEM_LENGTH ||
          (item.note?.length ?? 0) > MAX_NOTE_LENGTH,
      );
      if (tooLong) {
        return NextResponse.json(
          { error: "Item-Name oder Bemerkung ist zu lang." },
          { status: 400 },
        );
      }
      if (items.length > MAX_ITEMS) {
        return NextResponse.json(
          { error: `Maximal ${MAX_ITEMS} vorgemerkte Items erlaubt.` },
          { status: 400 },
        );
      }
      update.next_delivery_items = items;
    }
    // Der Liefer-Snapshot wird nur beim erstmaligen Beliefern gesetzt oder
    // beim expliziten Zurücksetzen gelöscht. Änderungen an Vormerkungen
    // dürfen die Historie nicht nachträglich verändern.
    if (body.is_delivered === true && Array.isArray(body.delivered_items)) {
      const deliveredItems = parseDeliveredItems(body.delivered_items);
      if (deliveredItems.length > MAX_ITEMS) {
        return NextResponse.json(
          { error: `Maximal ${MAX_ITEMS} gelieferte Items erlaubt.` },
          { status: 400 },
        );
      }
      update.delivered_items = deliveredItems;
    } else if (body.is_delivered === false) {
      update.delivered_items = [];
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Keine Änderung übermittelt." },
        { status: 400 },
      );
    }

    const lww = await checkLww(supabase, "tour_stops", stopId, body.client_updated_at, [
      ["tour_id", id],
    ]);
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
    }

    const updatePayload: Database["public"]["Tables"]["tour_stops"]["Update"] = {
      ...update,
    };
    if (lww.status === "apply") {
      updatePayload.client_updated_at = lww.clientUpdatedAt;
    }
    updatePayload.synced_at = new Date().toISOString();

    const missingUndeliverableColumns = (err: {
      code?: string;
      message?: string;
    }) =>
      err.code === "PGRST204" ||
      String(err.message ?? "").includes("is_undeliverable");

    const applyUpdate = async (payload: typeof updatePayload) => {
      const res = await supabase
        .from("tour_stops")
        .update(payload)
        .eq("id", stopId)
        .eq("tour_id", id)
        .select()
        .single();
      return { data: res.data, error: res.error };
    };

    let result = await applyUpdate(updatePayload);
    if (result.error && missingUndeliverableColumns(result.error)) {
      // Migration 20260811000000 noch nicht angewendet: Die neuen Spalten
      // existieren nicht. Wenn der Client die „Nicht lieferbar“-Funktion
      // explizit nutzt, geht das noch nicht → freundliche Meldung. Für alle
      // anderen Fälle (z. B. normales „beliefert“) erneut ohne die neuen
      // Spalten versuchen, damit der Tagesablauf bis zur Migration weiter-
      // funktioniert (es kann ohne Migration ohnehin kein Stopp als
      // „nicht lieferbar“ markiert sein, dessen Zustand gelöscht werden müsste).
      if (
        body.is_undeliverable !== undefined ||
        typeof body.undeliverable_reason === "string"
      ) {
        return NextResponse.json(
          {
            error:
              "Diese Funktion ist noch nicht freigeschaltet – bitte das Datenbank-Update ausführen (siehe Changelog).",
          },
          { status: 503 },
        );
      }
      const stripped: typeof updatePayload = { ...updatePayload };
      delete (stripped as Record<string, unknown>).is_undeliverable;
      delete (stripped as Record<string, unknown>).undeliverable_reason;
      result = await applyUpdate(stripped);
    }

    const { data, error } = result;
    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Stopp nicht gefunden." },
          { status: 404 },
        );
      }
      throw error;
    }
    return NextResponse.json({ stop: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
