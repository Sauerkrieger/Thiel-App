import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";
import type { TourStatus } from "@/types/database";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const TOUR_STATUSES: readonly TourStatus[] = [
  "packing",
  "in_transit",
  "completed",
];

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
        "*, tour_stops(*, object:objects(id, name, address, category))",
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
      })),
    };
    return NextResponse.json({ tour });
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

    if (!TOUR_STATUSES.includes(status as TourStatus)) {
      return NextResponse.json(
        { error: "Ungültiger Tour-Status." },
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
    const { data, error } = await supabase
      .from("active_tours")
      .update({ status: status as TourStatus })
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
