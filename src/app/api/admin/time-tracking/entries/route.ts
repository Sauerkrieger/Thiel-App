import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { enforcedBreakMinutes } from "@/lib/time-format";
import {
  auditSnapshotOf,
  logTimeEntryChange,
} from "@/lib/time-tracking";
import type { Database } from "@/types/database";
import type { TimeEntry } from "@/types/time-tracking";

export const dynamic = "force-dynamic";

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const MAX_NOTE_LENGTH = 500;
const MAX_BREAK_MINUTES = 24 * 60;

type EntryRow = Database["public"]["Tables"]["time_entries"]["Row"];

/**
 * POST /api/admin/time-tracking/entries – Stempelung manuell nacherfassen.
 *
 * Admins erfassen für einen Mitarbeiter (user_id) einen fehlenden Eintrag
 * mit Start-, Endzeit und Pause. Der Eintrag wird sofort freigegeben
 * (is_approved = true, source = 'submitted') und die Mindestpause nach
 * § 4 ArbZG ergänzt. Pflicht: Ein Eintrag im revisionssicheren
 * time_entry_audit_logs (mit der übergebenen Begründung).
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user)
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  if (!isAdmin(auth.user))
    return NextResponse.json(
      { error: "Nur Admins dürfen Arbeitszeiten erfassen." },
      { status: 403 },
    );

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const startRaw = body.clock_in;
    const endRaw = body.clock_out;
    if (!userId) {
      return NextResponse.json(
        { error: "Mitarbeiter fehlt (user_id)." },
        { status: 400 },
      );
    }
    if (
      typeof startRaw !== "string" ||
      !ISO_DATETIME.test(startRaw) ||
      Number.isNaN(new Date(startRaw).getTime())
    ) {
      return NextResponse.json({ error: "Ungültige Startzeit." }, { status: 400 });
    }
    if (
      typeof endRaw !== "string" ||
      !ISO_DATETIME.test(endRaw) ||
      Number.isNaN(new Date(endRaw).getTime())
    ) {
      return NextResponse.json({ error: "Ungültige Endzeit." }, { status: 400 });
    }
    const start = new Date(new Date(startRaw).getTime()).toISOString();
    const end = new Date(new Date(endRaw).getTime()).toISOString();
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      return NextResponse.json(
        { error: "Die Endzeit muss nach der Startzeit liegen." },
        { status: 400 },
      );
    }
    const breakValue =
      body.break_duration_minutes === undefined
        ? 0
        : Number(body.break_duration_minutes);
    if (!Number.isInteger(breakValue) || breakValue < 0 || breakValue > MAX_BREAK_MINUTES) {
      return NextResponse.json({ error: "Ungültige Pausendauer." }, { status: 400 });
    }
    const rawNote = body.note;
    const note =
      typeof rawNote === "string" && rawNote.trim()
        ? rawNote.trim().slice(0, MAX_NOTE_LENGTH)
        : null;
    // Mindestpause nach § 4 ArbZG (ergänzt, nie reduziert).
    const breakMinutes = enforcedBreakMinutes(start, end, breakValue);

    const supabase = getSupabaseAdmin();
    // Ziel-Mitarbeiter muss existieren.
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) {
      return NextResponse.json(
        { error: "Mitarbeiter nicht gefunden." },
        { status: 404 },
      );
    }

    const insertPayload: Database["public"]["Tables"]["time_entries"]["Insert"] = {
      user_id: userId,
      clock_in: start,
      clock_out: end,
      break_duration_minutes: breakMinutes,
      note,
      is_approved: true,
      requires_review: false,
      // Manuell erfasst → wie nachgereichte Arbeitszeit, aber sofort freigegeben.
      source: "submitted",
      synced_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("time_entries")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) throw error;

    const rawReason = body.change_reason;
    const changeReason =
      typeof rawReason === "string" && rawReason.trim()
        ? rawReason.trim().slice(0, MAX_NOTE_LENGTH)
        : "Manuell nacherfasst";
    // Audit-Log ist Pflicht für manuell erfasste Einträge.
    await logTimeEntryChange(supabase, {
      timeEntryId: data.id,
      changedByUserId: auth.user.id,
      oldValues: null,
      newValues: auditSnapshotOf(data as EntryRow),
      changeReason,
    });

    return NextResponse.json({ entry: data as TimeEntry }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
