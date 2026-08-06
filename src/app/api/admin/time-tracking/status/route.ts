import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/admin/time-tracking/status – Mitarbeiterstatus für Admins. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen den Mitarbeiterstatus sehen." }, { status: 403 });

  try {
    const supabase = getSupabaseAdmin();
    const [{ data: profiles, error: profilesError }, { data: openEntries, error: entriesError }] = await Promise.all([
      supabase.from("profiles").select("id, name, role, vacation_days_total, vacation_days_used, overtime_hours").order("name"),
      supabase.from("time_entries").select("*").is("clock_out", null).order("clock_in", { ascending: false }),
    ]);
    if (profilesError) throw profilesError;
    if (entriesError) throw entriesError;
    const entryByUser = new Map((openEntries ?? []).map((entry) => [entry.user_id, entry]));
    return NextResponse.json({
      employees: (profiles ?? []).map((profile) => ({
        ...profile,
        current_entry: entryByUser.get(profile.id) ?? null,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
