import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/objects/[id]/pack-info -> Items + Extra-Items der letzten Tour. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const excludeTour = new URL(request.url).searchParams.get("exclude_tour");
    const supabase = getSupabaseAdmin();
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
