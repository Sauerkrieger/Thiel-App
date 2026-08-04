import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";
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

/** PATCH /api/tours/[id]/stops/[stopId] -> is_delivered + next_delivery_items. */
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
      next_delivery_items?: DeliveryItem[];
    } = {};

    if (typeof body.is_delivered === "boolean") {
      update.is_delivered = body.is_delivered;
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

    const { data, error } = await supabase
      .from("tour_stops")
      .update(updatePayload)
      .eq("id", stopId)
      .eq("tour_id", id)
      .select()
      .single();

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
