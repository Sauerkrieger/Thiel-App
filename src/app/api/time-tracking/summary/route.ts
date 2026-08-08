import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { flagOverdueTimeEntries } from "@/lib/time-tracking";

export const dynamic = "force-dynamic";

/** GET /api/time-tracking/summary – eigenes Stunden-/Urlaubskonto für das Dashboard. */
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
    // Überfällige offene Stempelungen (12 h / Mitternacht) als prüfbedürftig markieren.
    await flagOverdueTimeEntries(supabase);
    const [{ data: profile, error: profileError }, { data: entries, error: entriesError }, { data: requests, error: requestsError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, name, role, vacation_days_total, vacation_days_used, overtime_hours, contract_type")
        .eq("id", auth.user.id)
        .single(),
      supabase
        .from("time_entries")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("clock_in", { ascending: false }),
      supabase
        .from("time_off_requests")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("start_date", { ascending: false }),
    ]);
    if (profileError) throw profileError;
    if (entriesError) throw entriesError;
    if (requestsError) throw requestsError;

    return NextResponse.json({
      profile,
      entries: entries ?? [],
      requests: requests ?? [],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
