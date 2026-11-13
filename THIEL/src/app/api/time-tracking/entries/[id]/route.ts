import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { checkLww } from "@/lib/lww";
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

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH /api/time-tracking/entries/[id] – vergessene Ausstempelung nachreichen.
 *
 * Der Mitarbeiter trägt die tatsächliche Endzeit (sowie Pause/Notiz) für eine
 * vom System markierte, prüfbedürftige Stempelung nach. Der Eintrag wird
 * geschlossen und geht als „Nachgereicht / Warten auf Freigabe“ in den
 * Freigabe-Feed der Verwaltung (is_approved = false, source = 'submitted',
 * requires_review bleibt true – erst die Admin-Freigabe löst den Fall).
 */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const supabase = getSupabaseAdmin();

    const { data: entry, error: loadError } = await supabase
      .from("time_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!entry || entry.user_id !== auth.user.id) {
      return NextResponse.json(
        { error: "Eintrag nicht gefunden." },
        { status: 404 },
      );
    }
    if (entry.clock_out) {
      return NextResponse.json(
        { error: "Dieser Eintrag ist bereits abgeschlossen." },
        { status: 409 },
      );
    }
    if (!entry.requires_review || entry.is_approved) {
      return NextResponse.json(
        { error: "Dieser Eintrag ist nicht prüfbedürftig." },
        { status: 409 },
      );
    }

    const endRaw = body.clock_out;
    if (
      typeof endRaw !== "string" ||
      !ISO_DATETIME.test(endRaw) ||
      Number.isNaN(new Date(endRaw).getTime())
    ) {
      return NextResponse.json(
        { error: "Ungültige Endzeit." },
        { status: 400 },
      );
    }
    const endMs = new Date(endRaw).getTime();
    const startMs = Date.parse(entry.clock_in);
    if (endMs <= startMs) {
      return NextResponse.json(
        { error: "Die Endzeit muss nach der Einstempelzeit liegen." },
        { status: 400 },
      );
    }
    if (endMs > Date.now() + 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Die Endzeit liegt zu weit in der Zukunft." },
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
    // Mindestpause nach § 4 ArbZG ergänzen (Anwesenheitszeit > 6 / > 9 h).
    breakDuration = enforcedBreakMinutes(entry.clock_in, new Date(endMs).toISOString(), breakDuration);
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, MAX_NOTE_LENGTH)
        : null;

    const lww = await checkLww(
      supabase,
      "time_entries",
      id,
      body.client_updated_at,
      [["user_id", auth.user.id]],
    );
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
    }

    const payload: Database["public"]["Tables"]["time_entries"]["Update"] = {
      clock_out: new Date(endMs).toISOString(),
      break_duration_minutes: breakDuration,
      note,
      // Nachgereichte Arbeitszeit: läuft durch den Freigabe-Feed.
      is_approved: false,
      source: "submitted",
      synced_at: new Date().toISOString(),
    };
    if (lww.status === "apply") {
      payload.client_updated_at = lww.clientUpdatedAt;
    }

    const { data, error } = await supabase
      .from("time_entries")
      .update(payload)
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .select("*")
      .single();
    if (error) throw error;

    // Revisionssicheres Änderungsprotokoll: Auch die Nachreichung durch den
    // Mitarbeiter (Zwangspopup) wird protokolliert – der Admin sieht im
    // Zeitadmin „Vergessene Ausstempelung nachgereicht von …“.
    const updated = data as TimeEntry;
    await logTimeEntryChange(supabase, {
      timeEntryId: id,
      changedByUserId: auth.user.id,
      oldValues: auditSnapshotOf(entry as TimeEntry),
      newValues: auditSnapshotOf(updated),
      changeReason: "Vergessene Ausstempelung nachgereicht",
    });

    return NextResponse.json({ entry: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
