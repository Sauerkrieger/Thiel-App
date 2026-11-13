import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { flagOverdueTimeEntries } from "@/lib/time-tracking";
import type { TimeEntry } from "@/types/time-tracking";

export const dynamic = "force-dynamic";

/**
 * GET /api/time-tracking/review – ungelöste, prüfbedürftige Stempelungen des
 * Nutzers (vergessene Ausstempelung, noch nicht vom Admin freigegeben).
 *
 * Wird beim App-Start vom Zwangspopup abgefragt. Markiert vorher überfällige
 * offene Einträge (12 h / Mitternacht), damit auch „im Stillen“ überfällige
 * Stempelungen sofort auftauchen.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    await flagOverdueTimeEntries(supabase);
    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", auth.user.id)
      .eq("requires_review", true)
      .eq("is_approved", false)
      // Nur noch OFFENE Einträge brauchen die Eingabe des Mitarbeiters.
      // Hat der Mitarbeiter bereits eine Endzeit eingereicht (oder der Admin
      // korrigiert), erscheint kein erneutes Popup.
      .is("clock_out", null)
      .order("clock_in", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ entries: (data ?? []) as TimeEntry[] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
