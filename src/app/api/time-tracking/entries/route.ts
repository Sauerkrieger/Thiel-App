import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { loadProfileRefs } from "@/lib/time-tracking";
import { parseClientUpdatedAt } from "@/lib/lww";
import type { Database } from "@/types/database";
import type { TimeEntry } from "@/types/time-tracking";

export const dynamic = "force-dynamic";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const MAX_NOTE_LENGTH = 500;
const MAX_BREAK_MINUTES = 24 * 60;

function validDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATETIME.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

/** GET /api/time-tracking/entries – eigene Stempelungen im Zeitraum. */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if ((from && !ISO_DATE_TIME.test(from)) || (to && !ISO_DATE_TIME.test(to))) {
      return NextResponse.json({ error: "Ungültiger Zeitraum." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("time_entries")
      .select("*")
      .order("clock_in", { ascending: false });
    const requestedUserId = url.searchParams.get("user_id");
    if (!isAdmin(auth.user) || requestedUserId) {
      query = query.eq("user_id", isAdmin(auth.user) && requestedUserId ? requestedUserId : auth.user.id);
    }
    if (from) query = query.gte("clock_in", from);
    if (to) query = query.lte("clock_in", to);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const userIds = rows
      .map((row) => row.user_id)
      .filter((id): id is string => typeof id === "string");
    const profileById = await loadProfileRefs(userIds);
    const entries = rows.map((row) => ({
      ...row,
      profiles: profileById.get(String(row.user_id)) ?? null,
    }));
    return NextResponse.json({ entries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/time-tracking/entries – „Arbeitszeit nachreichen“ (vergessene
 * Stempelung). Der Eintrag wird mit is_approved = false angelegt und erscheint
 * dadurch im Freigabe-Feed der Verwaltung.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const clockIn = body.clock_in;
    const clockOut = body.clock_out;
    if (!validDateTime(clockIn) || !validDateTime(clockOut)) {
      return NextResponse.json(
        { error: "Ungültige Uhrzeiten. Erwartet wird ein ISO-Zeitstempel." },
        { status: 400 },
      );
    }
    const startMs = new Date(clockIn).getTime();
    const endMs = new Date(clockOut).getTime();
    if (endMs <= startMs) {
      return NextResponse.json(
        { error: "Die Endzeit muss nach der Startzeit liegen." },
        { status: 400 },
      );
    }
    // Plausibilitäts-Check gegen Tippfehler: max. 1 Jahr in der Vergangenheit,
    // max. 24 h in der Zukunft (für Start und Ende).
    const now = Date.now();
    if (
      startMs < now - 365 * 24 * 60 * 60 * 1000 ||
      startMs > now + 24 * 60 * 60 * 1000 ||
      endMs > now + 24 * 60 * 60 * 1000
    ) {
      return NextResponse.json(
        { error: "Der Zeitraum liegt außerhalb des erlaubten Bereichs." },
        { status: 400 },
      );
    }

    let breakDuration = 0;
    if (body.break_duration_minutes !== undefined) {
      const value = Number(body.break_duration_minutes);
      if (!Number.isInteger(value) || value < 0 || value > MAX_BREAK_MINUTES) {
        return NextResponse.json(
          { error: "Ungültige Pausendauer." },
          { status: 400 },
        );
      }
      breakDuration = value;
    }
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, MAX_NOTE_LENGTH)
        : null;

    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    if (body.client_updated_at !== undefined && !clientUpdatedAt) {
      return NextResponse.json(
        { error: "Ungültiger client_updated_at-Zeitstempel." },
        { status: 400 },
      );
    }

    const payload: Database["public"]["Tables"]["time_entries"]["Insert"] = {
      user_id: auth.user.id,
      clock_in: new Date(clockIn).toISOString(),
      clock_out: new Date(clockOut).toISOString(),
      break_duration_minutes: breakDuration,
      note,
      // Wartet auf Freigabe durch die Verwaltung.
      is_approved: false,
      // Nachgereichte Arbeitszeit: läuft durch den Freigabe-Feed.
      source: "submitted",
      synced_at: new Date().toISOString(),
    };
    if (clientUpdatedAt) {
      payload.created_at = clientUpdatedAt;
      payload.updated_at = clientUpdatedAt;
      payload.client_updated_at = clientUpdatedAt;
    }

    const { data, error } = await getSupabaseAdmin()
      .from("time_entries")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ entry: data as TimeEntry }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
