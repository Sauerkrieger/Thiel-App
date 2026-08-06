import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
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
      .select("*, profiles:user_id(name, role)")
      .order("start_date", { ascending: false });
    if (!isAdmin(auth.user)) query = query.eq("user_id", auth.user.id);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ requests: data ?? [] });
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

    const requestedUserId = typeof body.user_id === "string" ? body.user_id : null;
    let targetUserId = auth.user.id;
    if (isAdmin(auth.user) && requestedUserId) {
      // Admin-Nachtrag: Zielnutzer muss existieren (sonst 400 statt FK-Fehler).
      const { data: target, error: targetError } = await getSupabaseAdmin()
        .from("profiles")
        .select("id")
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
    }
    const payload: Database["public"]["Tables"]["time_off_requests"]["Insert"] = {
      user_id: targetUserId,
      type: type as TimeOffType,
      start_date: startDate,
      end_date: endDate,
      status: "pending",
      reviewer_note: reviewerNote,
      employee_note: employeeNote,
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
    return NextResponse.json({ request: data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** PATCH /api/time-tracking/requests/[id] ist in der dynamischen Unterroute. */
export function isTimeOffStatus(value: unknown): value is TimeOffStatus {
  return typeof value === "string" && STATUSES.includes(value as TimeOffStatus);
}
