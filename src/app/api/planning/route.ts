import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isPlanner } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/planning -> Objektliste für die Tourenplanung.
 *
 * Die Auswahl wird pro Tour manuell getroffen und nicht mehr gespeichert
 * (Wochentags-Vorauswahl entfernt) – deshalb liefert der Endpunkt nur noch
 * die Objekte.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isPlanner(auth.user)) {
    return NextResponse.json(
      { error: "Nur Fahrer, Springer und Admins dürfen Touren planen." },
      { status: 403 },
    );
  }

  try {
    const { data: objects, error } = await getSupabaseAdmin()
      .from("objects")
      .select(
        "id, name, address, category, is_pedestrian_zone_until_11, opens_at, remark",
      )
      .order("name");
    if (error) throw error;

    return NextResponse.json({ objects: objects ?? [] });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
