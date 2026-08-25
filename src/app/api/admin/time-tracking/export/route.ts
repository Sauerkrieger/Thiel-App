import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Fahrer",
  facility_manager: "Reinigungskraft",
  cleaner: "Reinigungskraft",
  substitute: "Springer",
};
const DAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const TYPE_LABELS: Record<string, string> = {
  vacation: "Urlaub",
  sick_leave: "Krankheit",
  compensatory: "Freizeitausgleich",
  unpaid: "Unbezahlt",
};

function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}
function dateTimeLabel(value: string): string {
  return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function isWeekday(date: Date): boolean {
  return date.getDay() !== 0 && date.getDay() !== 6;
}
function monthTargetHours(from: string, to: string, weeklyHours: number, workingDays: number): number {
  if (!Number.isFinite(weeklyHours) || !Number.isFinite(workingDays) || workingDays <= 0) return 0;
  let weekdays = 0;
  const date = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (date <= end) {
    if (isWeekday(date)) weekdays += 1;
    date.setDate(date.getDate() + 1);
  }
  return weekdays * (weeklyHours / workingDays);
}
function overlapWeekdayCount(startDate: string, endDate: string, from: string, to: string): number {
  const start = new Date(`${startDate < from ? from : startDate}T00:00:00`);
  const end = new Date(`${endDate > to ? to : endDate}T00:00:00`);
  let weekdays = 0;
  while (start <= end) {
    if (isWeekday(start)) weekdays += 1;
    start.setDate(start.getDate() + 1);
  }
  return weekdays;
}

function approvalNameFor(entryId: string, logs: Array<{ time_entry_id: string | null; changed_by_user_id: string | null; new_values: unknown; changed_at: string }>, profileById: Map<string, Record<string, unknown>>): string {
  const approval = logs.find((log) => log.time_entry_id === entryId && typeof log.new_values === "object" && log.new_values !== null && (log.new_values as Record<string, unknown>).is_approved === true);
  const name = approval?.changed_by_user_id ? profileById.get(approval.changed_by_user_id)?.name : undefined;
  return typeof name === "string" ? name : "";
}
function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function numberLabel(value: number | null, digits = 2): string {
  return value == null ? "" : value.toFixed(digits).replace(".", ",");
}
function profileName(profile: Record<string, unknown> | undefined, fallback: string): { first: string; last: string } {
  const first = [profile?.first_name, profile?.vorname].find((value) => typeof value === "string" && value.trim());
  const last = [profile?.last_name, profile?.nachname].find((value) => typeof value === "string" && value.trim());
  if (typeof first === "string" || typeof last === "string") return { first: typeof first === "string" ? first.trim() : "", last: typeof last === "string" ? last.trim() : "" };
  const parts = String(profile?.name ?? fallback).trim().split(/\s+/).filter(Boolean);
  return { first: parts.shift() ?? "", last: parts.join(" ") };
}
function personnelNumber(profile: Record<string, unknown> | undefined, userId: string): string {
  const explicit = [profile?.personalnummer, profile?.personal_number].find((value) => typeof value === "string" || typeof value === "number");
  if (explicit !== undefined) return String(explicit);
  return `MA-${userId.replace(/-/g, "").slice(-6).toUpperCase()}`;
}
function roleLabel(value: unknown): string {
  return typeof value === "string" ? ROLE_LABELS[value] ?? value : "";
}
function statusLabel(approved: boolean, closed: boolean): string {
  if (!approved) return "Ausstehend";
  return closed ? "Freigegeben" : "Ausstehend";
}
function workingHours(entry: { clock_in: string; clock_out: string | null; break_duration_minutes: number }): number | null {
  if (!entry.clock_out) return null;
  return Math.max(0, (Date.parse(entry.clock_out) - Date.parse(entry.clock_in)) / 3_600_000 - Number(entry.break_duration_minutes ?? 0) / 60);
}
function monthBounds(month: string | null): { from: string; to: string; label: string } {
  const match = month?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return { from, to: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`, label: `${String(monthIndex + 1).padStart(2, "0")}_${year}` };
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen Lohnexporte erstellen." }, { status: 403 });

  try {
    const url = new URL(request.url);
    const bounds = monthBounds(url.searchParams.get("month"));
    const from = url.searchParams.get("from") ?? `${bounds.from}T00:00:00.000Z`;
    const to = url.searchParams.get("to") ?? `${bounds.to}T23:59:59.999Z`;
    const mode = url.searchParams.get("mode") ?? "details";
    const supabase = getSupabaseAdmin();

    const [{ data: profiles, error: profilesError }, { data: entries, error: entriesError }, { data: requests, error: requestsError }, { data: assignments, error: assignmentsError }, { data: tours, error: toursError }, { data: auditLogs, error: auditLogsError }] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("time_entries").select("*").gte("clock_in", from).lte("clock_in", to).order("clock_in"),
      supabase.from("time_off_requests").select("*").lte("start_date", bounds.to).gte("end_date", bounds.from),
      supabase.from("object_assignments").select("user_id, object_id, objects:object_id(name)"),
      supabase.from("active_tours").select("id, driver_id, date, tour_stops(object_id, stop_order, objects:object_id(id, name))"),
      supabase.from("time_entry_audit_logs").select("time_entry_id, changed_by_user_id, new_values, changed_at").order("changed_at", { ascending: false }),
    ]);
    if (profilesError) throw profilesError;
    if (entriesError) throw entriesError;
    if (requestsError) throw requestsError;
    if (assignmentsError) throw assignmentsError;
    if (toursError) throw toursError;
    if (auditLogsError) throw auditLogsError;

    const profileById = new Map<string, Record<string, unknown>>((profiles ?? []).map((profile) => [profile.id, profile as Record<string, unknown>]));
    const objectsByUser = new Map<string, string[]>();
    for (const assignment of (assignments ?? []) as Array<{ user_id: string; objects?: { name?: string } | null }>) {
      if (!assignment.objects?.name) continue;
      const names = objectsByUser.get(assignment.user_id) ?? [];
      names.push(assignment.objects.name);
      objectsByUser.set(assignment.user_id, names);
    }
    const tourObjectsByDriverDate = new Map<string, string[]>();
    for (const tour of (tours ?? []) as unknown as Array<{ driver_id: string | null; date: string; tour_stops?: Array<{ stop_order: number; objects?: { name?: string } | null }> }>) {
      if (!tour.driver_id) continue;
      const names = (tour.tour_stops ?? []).slice().sort((a, b) => a.stop_order - b.stop_order).map((stop) => stop.objects?.name).filter((name): name is string => Boolean(name));
      const key = `${tour.driver_id}:${tour.date}`;
      tourObjectsByDriverDate.set(key, [...new Set([...(tourObjectsByDriverDate.get(key) ?? []), ...names])]);
    }
    const exportAuditLogs = (auditLogs ?? []) as Array<{ time_entry_id: string | null; changed_by_user_id: string | null; new_values: unknown; changed_at: string }>;
    const requestsByUser = new Map<string, Array<Record<string, unknown>>>();
    for (const requestRow of (requests ?? []) as Array<Record<string, unknown>>) {
      const list = requestsByUser.get(String(requestRow.user_id)) ?? [];
      list.push(requestRow);
      requestsByUser.set(String(requestRow.user_id), list);
    }

    if (mode === "summary") {
      const summaryRows = [["Personalnummer", "Nachname", "Vorname", "Rolle", "Soll_Stunden", "Ist_Stunden", "Krankheit_Stunden", "Urlaub_Stunden", "Ueberstunden_Stunden", "Status"]];
      for (const profile of profiles ?? []) {
        const name = profileName(profile as Record<string, unknown>, profile.id);
        const employeeEntries = (entries ?? []).filter((entry) => entry.user_id === profile.id);
        const regular = employeeEntries.reduce((sum, entry) => sum + (entry.is_approved ? workingHours(entry) ?? 0 : 0), 0);
        const absences = requestsByUser.get(profile.id) ?? [];
        const weeklyHours = Number(profile.weekly_target_hours ?? 40);
        const workingDays = Number(profile.working_days_per_week ?? 5);
        const dailySoll = workingDays > 0 ? weeklyHours / workingDays : 0;
        const targetHours = monthTargetHours(bounds.from, bounds.to, weeklyHours, workingDays);
        const absenceHours = (type: string) => absences.filter((item) => item.type === type && item.status === "approved").reduce((sum, item) => sum + overlapWeekdayCount(String(item.start_date), String(item.end_date), bounds.from, bounds.to) * dailySoll, 0);
        const hasOpen = employeeEntries.some((entry) => !entry.clock_out || !entry.is_approved) || absences.some((item) => item.status === "pending");
        summaryRows.push([personnelNumber(profile as Record<string, unknown>, profile.id), name.last, name.first, roleLabel(profile.role), numberLabel(targetHours), numberLabel(regular), numberLabel(absenceHours("sick_leave")), numberLabel(absenceHours("vacation")), numberLabel(regular - targetHours), hasOpen ? "Offene Einträge" : "Vollständig freigegeben"]);
      }
      const csv = "\uFEFF" + summaryRows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Lohnexport_Thiel_Monatsuebersicht_${bounds.label}.csv"`, "Cache-Control": "no-store" } });
    }

    const detailRows = [["Datum", "Wochentag", "Personalnummer", "Nachname", "Vorname", "Rolle", "Einsatzort_Objekt", "Schichttyp", "Von", "Bis", "Pause_Minuten", "Arbeitszeit_Stunden", "Status", "Freigegeben_Von", "Bemerkung"]];
    for (const entry of entries ?? []) {
      const profile = profileById.get(entry.user_id);
      const name = profileName(profile, entry.user_id);
      const hours = workingHours(entry);
      const absence = (requestsByUser.get(entry.user_id) ?? []).find((item) => item.status === "approved" && String(item.start_date) <= entry.clock_in.slice(0, 10) && String(item.end_date) >= entry.clock_in.slice(0, 10));
      const date = new Date(entry.clock_in);
      const locationNames = tourObjectsByDriverDate.get(`${entry.user_id}:${entry.clock_in.slice(0, 10)}`) ?? objectsByUser.get(entry.user_id) ?? [];
      detailRows.push([dateTimeLabel(entry.clock_in), DAY_LABELS[date.getDay()], personnelNumber(profile, entry.user_id), name.last, name.first, profile ? roleLabel(profile.role) : "", locationNames.join(", "), absence ? TYPE_LABELS[String(absence.type)] : "Arbeit", timeLabel(entry.clock_in), entry.clock_out ? timeLabel(entry.clock_out) : "", String(entry.break_duration_minutes ?? 0), hours == null ? "" : numberLabel(hours), statusLabel(Boolean(entry.is_approved), Boolean(entry.clock_out)), approvalNameFor(entry.id, exportAuditLogs, profileById), entry.note ?? ""]);
    }
    for (const requestRow of requests ?? []) {
      // Auch abgelehnte Abwesenheiten werden exportiert, damit der Status
      // für die Lohnbuchhaltung nachvollziehbar bleibt.
      const profile = profileById.get(requestRow.user_id);
      const name = profileName(profile, requestRow.user_id);
      const start = new Date(`${requestRow.start_date}T00:00:00`);
      const end = new Date(`${requestRow.end_date}T00:00:00`);
      for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
        const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        if (date < bounds.from || date > bounds.to) continue;
        detailRows.push([dateLabel(date), DAY_LABELS[day.getDay()], personnelNumber(profile, requestRow.user_id), name.last, name.first, profile ? (roleLabel(profile.role)) : "", "", TYPE_LABELS[String(requestRow.type)] ?? String(requestRow.type), "", "", "0", "", requestRow.status === "approved" ? "Freigegeben" : requestRow.status === "rejected" ? "Abgelehnt" : "Ausstehend", "", String(requestRow.employee_note ?? requestRow.reviewer_note ?? "")]);
      }
    }
    const csv = "\uFEFF" + detailRows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Lohnexport_Thiel_Schichtdetails_${bounds.label}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
