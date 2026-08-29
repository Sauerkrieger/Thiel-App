import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { notifySubstitutePush } from "@/lib/substitute-notify";
import { loadProfileRefs } from "@/lib/time-tracking";
import { checkLww, parseClientUpdatedAt } from "@/lib/lww";
import type { Database } from "@/types/database";
import type { TimeOffStatus, TimeOffType } from "@/types/time-tracking";

export const dynamic = "force-dynamic";

const TYPES: readonly TimeOffType[] = ["vacation", "sick_leave", "unpaid", "compensatory"];
const STATUSES: readonly TimeOffStatus[] = ["pending", "approved", "rejected"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 1000;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** GET /api/time-tracking/requests – eigene Anträge, Admin: alle Anträge. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  }
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("time_off_requests")
      .select("*")
      .order("start_date", { ascending: false });
    if (!isAdmin(auth.user)) query = query.eq("user_id", auth.user.id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const userIds = rows.flatMap((row) => [row.user_id, row.substitute_id])
      .filter((id): id is string => typeof id === "string");
    const profileById = await loadProfileRefs(userIds);
    const requests = rows.map((row) => ({
      ...row,
      profiles: profileById.get(String(row.user_id)) ?? null,
    }));
    return NextResponse.json({ requests });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/time-tracking/requests – Mitarbeiterantrag oder Admin-Nachtrag. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const type = body.type;
    const startDate = body.start_date;
    const endDate = body.end_date;
    if (!TYPES.includes(type as TimeOffType) || !validDate(startDate) || !validDate(endDate) || endDate < startDate) {
      return NextResponse.json({ error: "Ungültiger Abwesenheitszeitraum oder Typ." }, { status: 400 });
    }
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    if (body.client_updated_at !== undefined && !clientUpdatedAt) {
      return NextResponse.json({ error: "Ungültiger client_updated_at-Zeitstempel." }, { status: 400 });
    }
    let reviewerNote: string | null = null;
    if (typeof body.reviewer_note === "string" && isAdmin(auth.user)) {
      reviewerNote = body.reviewer_note.trim().slice(0, MAX_NOTE) || null;
    }
    const employeeNote = typeof body.employee_note === "string"
      ? body.employee_note.trim().slice(0, MAX_NOTE) || null
      : null;
    const requestedSubstituteId = typeof body.substitute_id === "string" && body.substitute_id.trim()
      ? body.substitute_id.trim()
      : null;
    const selfSubstitute = body.substitute_request === true;
    const substituteKind = body.substitute_kind === "driver" || body.substitute_kind === "facility_manager"
      ? body.substitute_kind
      : null;
    const substituteObjectId = typeof body.substitute_object_id === "string" && body.substitute_object_id.trim()
      ? body.substitute_object_id.trim()
      : null;
    if (selfSubstitute && auth.user.role !== "substitute") {
      return NextResponse.json({ error: "Nur Springer dürfen eigene Vertretungen einreichen." }, { status: 403 });
    }
    if (selfSubstitute && (!substituteKind || (substituteKind === "facility_manager" && !substituteObjectId))) {
      return NextResponse.json({ error: "Vertretungsart und bei Reinigung das Objekt sind erforderlich." }, { status: 400 });
    }
    const requestedStatus = selfSubstitute ? "pending" : (isAdmin(auth.user) && body.status === "approved" ? "approved" : "pending");

    const requestedUserId = typeof body.user_id === "string" ? body.user_id : null;
    let targetUserId = auth.user.id;
    let targetUserName = auth.user.name;
    if (isAdmin(auth.user) && requestedUserId) {
      // Admin-Nachtrag: Zielnutzer muss existieren (sonst 400 statt FK-Fehler).
      const { data: target, error: targetError } = await getSupabaseAdmin()
        .from("profiles")
        .select("id, name")
        .eq("id", requestedUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) {
        return NextResponse.json(
          { error: "Der gewählte Mitarbeiter existiert nicht." },
          { status: 400 },
        );
      }
      targetUserId = requestedUserId;
      targetUserName = target.name;
    }
    if (selfSubstitute) {
      targetUserId = auth.user.id;
      targetUserName = auth.user.name;
    }
    if (requestedSubstituteId === targetUserId && !selfSubstitute) {
      return NextResponse.json({ error: "Die Vertretung darf nicht der Antragsteller sein." }, { status: 400 });
    }
    if (requestedSubstituteId) {
      const { data: substitute, error: substituteError } = await getSupabaseAdmin()
        .from("profiles")
        .select("id")
        .eq("id", requestedSubstituteId)
        .maybeSingle();
      if (substituteError) throw substituteError;
      if (!substitute) {
        return NextResponse.json({ error: "Der gewählte Vertreter existiert nicht." }, { status: 400 });
      }
    }
    const payload: Database["public"]["Tables"]["time_off_requests"]["Insert"] = {
      user_id: targetUserId,
      type: type as TimeOffType,
      start_date: startDate,
      end_date: endDate,
      status: requestedStatus,
      reviewer_note: reviewerNote,
      employee_note: employeeNote,
      substitute_id: selfSubstitute ? auth.user.id : requestedSubstituteId,
      substitute_request: selfSubstitute,
      substitute_kind: selfSubstitute ? substituteKind : null,
      substitute_object_id: selfSubstitute ? substituteObjectId : null,
      synced_at: new Date().toISOString(),
    };
    if (clientUpdatedAt) {
      payload.created_at = clientUpdatedAt;
      payload.updated_at = clientUpdatedAt;
      payload.client_updated_at = clientUpdatedAt;
    }
    const { data, error } = await getSupabaseAdmin()
      .from("time_off_requests")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;

    // Der Springer bekommt eine Push-Benachrichtigung, sobald ein Admin ihn
    // als Vertretung einträgt (Admin-Nachträge sind direkt genehmigt).
    const created = data as { substitute_id: string | null; status: string; start_date: string; end_date: string };
    if (created.substitute_id && created.status === "approved") {
      await notifySubstitutePush({
        substituteId: created.substitute_id,
        absentName: targetUserName,
        startDate: created.start_date,
        endDate: created.end_date,
      }).catch(() => {});
    }

    return NextResponse.json({ request: data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** PATCH /api/time-tracking/requests/[id] ist in der dynamischen Unterroute. */
export function isTimeOffStatus(value: unknown): value is TimeOffStatus {
  return typeof value === "string" && STATUSES.includes(value as TimeOffStatus);
}
