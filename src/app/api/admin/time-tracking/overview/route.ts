import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import type { ProfileRef } from "@/lib/time-tracking";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen die Zeiterfassung verwalten." }, { status: 403 });

  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const role = url.searchParams.get("role");
    const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const supabase = getSupabaseAdmin();
    const [{ data: profiles, error: profilesError }, { data: entries, error: entriesError }, { data: requests, error: requestsError }, { data: tours, error: toursError }] = await Promise.all([
      supabase.from("profiles").select("id, name, role, email, vacation_days_total, vacation_days_used, overtime_hours, contract_type").order("name"),
      // Kein `profiles:user_id(...)`-Embed: time_entries.user_id referenziert
      // auth.users, nicht profiles – die Namen werden unten per JS-Join ergänzt.
      supabase.from("time_entries").select("*").order("clock_in", { ascending: false }),
      supabase.from("time_off_requests").select("*").order("start_date", { ascending: false }),
      supabase.from("active_tours").select("id, driver_id, date, status, tour_stops(object_id, stop_order, is_delivered, objects:object_id(id, name))").eq("status", "in_transit"),
    ]);
    if (profilesError) throw profilesError;
    if (entriesError) throw entriesError;
    if (requestsError) throw requestsError;
    if (toursError) throw toursError;
    type OverviewTour = { id: string; driver_id: string | null; date: string; status: string; tour_stops?: Array<{ object_id: string; stop_order: number; is_delivered: boolean; objects?: { id: string; name: string } | null }> };
    const overviewTours = (tours ?? []) as unknown as OverviewTour[];
    const assignmentByDriver = new Map<string, { tour_id: string; tour_date: string; object_name: string | null }>();
    for (const tour of overviewTours) {
      if (!tour.driver_id) continue;
      const nextStop = [...(tour.tour_stops ?? [])].filter((stop) => !stop.is_delivered).sort((a, b) => a.stop_order - b.stop_order)[0];
      assignmentByDriver.set(tour.driver_id, { tour_id: tour.id, tour_date: tour.date, object_name: nextStop?.objects?.name ?? null });
    }
    type TimeEntryRow = { user_id: string; clock_in: string; clock_out: string | null };
    type OverviewEntry = TimeEntryRow & { profiles?: ProfileRef | null };
    type OverviewRequest = { user_id: string; [key: string]: unknown; profiles?: ProfileRef | null };
    // Mitarbeiternamen per JS-Join ergänzen (kein PostgREST-Embed nötig).
    const profileById = new Map<string, ProfileRef>(
      (profiles ?? []).map((profile) => [profile.id, { name: profile.name, role: profile.role }]),
    );
    const overviewEntries = ((entries ?? []) as OverviewEntry[]).map((entry) => ({
      ...entry,
      profiles: profileById.get(entry.user_id) ?? null,
    }));
    const overviewRequests = ((requests ?? []) as OverviewRequest[]).map((request) => ({
      ...request,
      profiles: profileById.get(String(request.user_id)) ?? null,
    }));

    const selectedProfiles = (profiles ?? []).filter((profile) => {
      const matchesRole = !role || profile.role === role;
      const matchesQuery = !query || profile.name.toLowerCase().includes(query) || (profile.email ?? "").toLowerCase().includes(query);
      return matchesRole && matchesQuery;
    });
    const selectedIds = new Set(selectedProfiles.map((profile) => profile.id));
    const filteredEntries = overviewEntries.filter((entry) => {
      if (!selectedIds.has(entry.user_id)) return false;
      if (from && entry.clock_in < from) return false;
      if (to && entry.clock_in > to) return false;
      return true;
    });
    const filteredRequests = overviewRequests.filter((request) => selectedIds.has(request.user_id));
    const openByUser = new Map(filteredEntries.filter((entry) => entry.clock_out == null).map((entry) => [entry.user_id, entry]));

    return NextResponse.json({
      employees: selectedProfiles.map((profile) => ({ ...profile, current_entry: openByUser.get(profile.id) ?? null, current_assignment: assignmentByDriver.get(profile.id) ?? null })),
      entries: filteredEntries,
      requests: filteredRequests,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
