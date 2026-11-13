import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";
import { requireUser, isFacilityManager } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/objects/[id]/pack-info -> Items + Extra-Items der letzten Tour. */
export async function GET(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const excludeTour = new URL(request.url).searchParams.get("exclude_tour");
    const supabase = getSupabaseAdmin();

    // Reinigungskraft: Pack-Infos nur zugewiesener Objekte.
    if (isFacilityManager(auth.user)) {
      const { data: assignment } = await supabase
        .from("object_assignments")
        .select("object_id")
        .eq("user_id", auth.user.id)
        .eq("object_id", id)
        .maybeSingle();
      if (!assignment) {
        return NextResponse.json(
          { error: "Objekt nicht gefunden." },
          { status: 404 },
        );
      }
    }
    let stopsQuery = supabase
      .from("tour_stops")
      .select("next_delivery_items, created_at")
      .eq("object_id", id)
      .order("created_at", { ascending: false });
    if (excludeTour) {
      stopsQuery = stopsQuery.neq("tour_id", excludeTour);
    }

    const [{ data: items, error: itemsError }, { data: lastStops, error: stopsError }] =
      await Promise.all([
        supabase
          .from("object_items")
          .select("*")
          .eq("object_id", id)
          .order("is_always_required", { ascending: false })
          .order("created_at", { ascending: true }),
        stopsQuery.limit(1),
      ]);

    if (itemsError) throw itemsError;
    if (stopsError) throw stopsError;

    const previousExtras = parseDeliveryItems(lastStops?.[0]?.next_delivery_items);

    return NextResponse.json({
      items: items ?? [],
      previous_extras: previousExtras,
    });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
