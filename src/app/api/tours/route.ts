import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseDeliveryItems } from "@/lib/items";
import type { TourStatus } from "@/types/database";

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

export async function POST(request: Request) {
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
