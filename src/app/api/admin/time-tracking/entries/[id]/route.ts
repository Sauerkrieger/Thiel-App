import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { checkLww, parseClientUpdatedAt } from "@/lib/lww";
import { enforcedBreakMinutes } from "@/lib/time-format";
import {
  auditSnapshotOf,
  logTimeEntryChange,
  type TimeEntryAuditSnapshot,
} from "@/lib/time-tracking";
import type { Database } from "@/types/database";
import type { TimeEntry } from "@/types/time-tracking";

export const dynamic = "force-dynamic";

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const MAX_NOTE_LENGTH = 500;
const MAX_BREAK_MINUTES = 24 * 60;

type Context = { params: Promise<{ id: string }> };

type EntryRow = Database["public"]["Tables"]["time_entries"]["Row"];

/** Standard-Begründung für das Audit-Log, wenn keine explizite übergeben wurde. */
function defaultChangeReason(
  payload: Database["public"]["Tables"]["time_entries"]["Update"],
): string {
  if (payload.clock_out && payload.is_approved === true) {
    return "Ausstempeln & Freigeben";
  }
  if (payload.clock_out) return "Ausstempeln (Korrektur)";
  if (payload.is_approved === true) return "Freigabe";
  if (payload.is_approved === false) return "Ablehnung";
  return "Korrektur";
}

/**
 * PATCH /api/admin/time-tracking/entries/[id] – Arbeitszeit freigeben/ablehnen
 * UND offene Stempelungen aktiv beenden (vergessene Ausstempelung).
 *
 * Erlaubte Felder: is_approved, clock_out, break_duration_minutes, note,
 * change_reason (Audit-Begründung). Eine Freigabe (is_approved = true) setzt
 * requires_review = false zurück – der Fall gilt damit als gelöst (zusätzlich
 * erledigt das der DB-Trigger). Die Mindestpause nach § 4 ArbZG wird ergänzt,
 * und jede Änderung landet revisionssicher im time_entry_audit_logs.
 */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen Arbeitszeiten prüfen." }, { status: 403 });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const hasApproval = typeof body.is_approved === "boolean";
    const hasEnd = typeof body.clock_out === "string";
    const hasBreak = body.break_duration_minutes !== undefined;
    const hasNote = typeof body.note === "string";
    if (!hasApproval && !hasEnd && !hasBreak && !hasNote) {
      return NextResponse.json({ error: "Keine Änderungen übergeben." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existing, error: loadError } = await supabase
      .from("time_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!existing) {
      return NextResponse.json({ error: "Eintrag nicht gefunden." }, { status: 404 });
    }

    const lww = await checkLww(supabase, "time_entries", id, body.client_updated_at);
    if (lww.status === "conflict") return lwwConflictResponse(lww.serverRecord);

    const payload: Database["public"]["Tables"]["time_entries"]["Update"] = {
      synced_at: new Date().toISOString(),
    };
    let effectiveEnd: string | null = null;
    if (hasApproval) {
      payload.is_approved = body.is_approved === true;
      // Freigabe löst den Prüfbedarf auf.
      if (payload.is_approved) payload.requires_review = false;
    }
    if (hasEnd) {
      const endRaw = body.clock_out;
      if (
        typeof endRaw !== "string" ||
        !ISO_DATETIME.test(endRaw) ||
        Number.isNaN(new Date(endRaw).getTime())
      ) {
        return NextResponse.json({ error: "Ungültige Endzeit." }, { status: 400 });
      }
      const endMs = new Date(endRaw).getTime();
      if (endMs <= Date.parse(existing.clock_in)) {
        return NextResponse.json(
          { error: "Die Endzeit muss nach der Einstempelzeit liegen." },
          { status: 400 },
        );
      }
      effectiveEnd = new Date(endMs).toISOString();
      payload.clock_out = effectiveEnd;
    }
    if (hasBreak) {
      const value = Number(body.break_duration_minutes);
      if (!Number.isInteger(value) || value < 0 || value > MAX_BREAK_MINUTES) {
        return NextResponse.json({ error: "Ungültige Pausendauer." }, { status: 400 });
      }
      payload.break_duration_minutes = value;
    }
    // Mindestpause nach § 4 ArbZG ergänzen, sobald eine Endzeit vorliegt.
    if (effectiveEnd) {
      payload.break_duration_minutes = enforcedBreakMinutes(
        existing.clock_in,
        effectiveEnd,
        payload.break_duration_minutes ?? 0,
      );
    }
    if (hasNote) {
      const rawNote = body.note;
      const note = typeof rawNote === "string" ? rawNote.trim() : "";
      payload.note = note ? note.slice(0, MAX_NOTE_LENGTH) : null;
    }
    // Defense-in-Depth: Eine offene Stempelung darf nicht ohne Endzeit
    // „freigegeben“ werden – sonst liefe sie prüfungslos weiter.
    if (payload.is_approved === true && existing.clock_out === null && !hasEnd) {
      return NextResponse.json(
        { error: "Offene Stempelung muss zuerst ausgestempelt werden." },
        { status: 400 },
      );
    }
    const timestamp = parseClientUpdatedAt(body.client_updated_at);
    if (timestamp) payload.client_updated_at = timestamp;

    const { data, error } = await supabase
      .from("time_entries")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    // Revisionssicheres Änderungsprotokoll (nur bei tatsächlicher Änderung).
    const updated = data as EntryRow;
    const oldSnapshot = auditSnapshotOf(existing as EntryRow);
    const newSnapshot: TimeEntryAuditSnapshot = auditSnapshotOf(updated);
    if (JSON.stringify(oldSnapshot) !== JSON.stringify(newSnapshot)) {
      const rawReason = body.change_reason;
      const reason =
        typeof rawReason === "string" && rawReason.trim()
          ? rawReason.trim().slice(0, MAX_NOTE_LENGTH)
          : defaultChangeReason(payload);
      await logTimeEntryChange(supabase, {
        timeEntryId: id,
        changedByUserId: auth.user.id,
        oldValues: oldSnapshot,
        newValues: newSnapshot,
        changeReason: reason,
      });
    }

    return NextResponse.json({ entry: updated as TimeEntry });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** DELETE /api/admin/time-tracking/entries/[id] – Eintrag löschen (mit Audit-Eintrag). */
export async function DELETE(
  _request: Request,
  { params }: Context,
) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen Arbeitszeiten löschen." }, { status: 403 });

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from("time_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    // Audit-Eintrag VOR dem Löschen schreiben (FK wird durch `on delete set null`
    // getrennt, der Protokolleintrag bleibt revisionssicher erhalten).
    if (existing) {
      await logTimeEntryChange(supabase, {
        timeEntryId: id,
        changedByUserId: auth.user.id,
        oldValues: auditSnapshotOf(existing as EntryRow),
        newValues: null,
        changeReason: "Eintrag gelöscht",
      });
    }
    const { error } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
