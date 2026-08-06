import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { checkLww, parseClientUpdatedAt } from "@/lib/lww";
import type { Database } from "@/types/database";
import type { TimeEntry } from "@/types/time-tracking";

export const dynamic = "force-dynamic";

const MAX_NOTE_LENGTH = 500;
const MAX_BREAK_MINUTES = 24 * 60;

/** GET /api/time-tracking/clock – aktuell offene Stempelung des Nutzers. */
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
    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", auth.user.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ entry: (data as TimeEntry | null) ?? null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/time-tracking/clock – ein- oder ausstempeln. */
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
    const action = body.action;
    if (action !== "clock_in" && action !== "clock_out") {
      return NextResponse.json(
        { error: "Ungültige Stempel-Aktion. Erlaubt sind clock_in oder clock_out." },
        { status: 400 },
      );
    }

    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    if (body.client_updated_at !== undefined && !clientUpdatedAt) {
      return NextResponse.json(
        { error: "Ungültiger client_updated_at-Zeitstempel." },
        { status: 400 },
      );
    }
    // Der tatsächliche Stempelzeitpunkt (Ereigniszeit). Wird offline als
    // `clock_in`/`clock_out` synchronisiert und muss daher unabhängig von der
    // LWW-Metadatenzeit übermittelt werden.
    const eventAt = parseClientUpdatedAt(body.event_at);
    if (body.event_at !== undefined && !eventAt) {
      return NextResponse.json(
        { error: "Ungültiger event_at-Zeitstempel." },
        { status: 400 },
      );
    }
    let now = eventAt ?? clientUpdatedAt ?? new Date().toISOString();
    // Schutz gegen verfälschte/weit in der Zukunft liegende Stempelzeiten:
    // Liegt die Ereigniszeit mehr als 48 h von der Serverzeit entfernt, wird
    // die Serverzeit verwendet (abweichende Geräteuhren / Manipulation).
    if (Math.abs(new Date(now).getTime() - Date.now()) > 48 * 60 * 60 * 1000) {
      now = new Date().toISOString();
    }
    const supabase = getSupabaseAdmin();

    const { data: openEntry, error: openError } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", auth.user.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openError) throw openError;

    if (action === "clock_in") {
      // Für bestehende Datensätze bleibt auch das Einstechen LWW-sicher;
      // bei einem offenen Eintrag ist der Request idempotent.
      if (openEntry && body.client_updated_at !== undefined) {
        const lww = await checkLww(
          supabase,
          "time_entries",
          openEntry.id,
          body.client_updated_at,
          [["user_id", auth.user.id]],
        );
        if (lww.status === "conflict") {
          return lwwConflictResponse(lww.serverRecord);
        }
      }

      // Wiederholte Requests (z. B. nach einem Offline-Reconnect) dürfen
      // keine zweite parallele Arbeitszeit eröffnen.
      if (openEntry) {
        return NextResponse.json({ entry: openEntry as TimeEntry });
      }

      const insertPayload: Database["public"]["Tables"]["time_entries"]["Insert"] = {
        user_id: auth.user.id,
        clock_in: now,
        clock_out: null,
        break_duration_minutes: 0,
        note: null,
        is_approved: true,
        synced_at: new Date().toISOString(),
      };
      if (clientUpdatedAt) {
        insertPayload.created_at = clientUpdatedAt;
        insertPayload.updated_at = clientUpdatedAt;
        insertPayload.client_updated_at = clientUpdatedAt;
      }

      const { data, error } = await supabase
        .from("time_entries")
        .insert(insertPayload)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ entry: data as TimeEntry }, { status: 201 });
    }

    if (!openEntry) {
      return NextResponse.json(
        { error: "Es ist keine offene Stempelung vorhanden." },
        { status: 409 },
      );
    }

    // Ausstempeln darf nicht vor dem Einstempeln liegen (DB-Constraint).
    // Ein 400 ist verständlicher als ein SQL-Fehler (500).
    if (new Date(now).getTime() < new Date(openEntry.clock_in).getTime()) {
      return NextResponse.json(
        { error: "Die Ausstempelzeit darf nicht vor der Einstempelzeit liegen." },
        { status: 400 },
      );
    }

    const lww = await checkLww(
      supabase,
      "time_entries",
      openEntry.id,
      body.client_updated_at,
      [["user_id", auth.user.id]],
    );
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
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

    let note: string | null = null;
    if (typeof body.note === "string" && body.note.trim()) {
      note = body.note.trim().slice(0, MAX_NOTE_LENGTH);
    }

    const updatePayload: Database["public"]["Tables"]["time_entries"]["Update"] = {
      clock_out: now,
      break_duration_minutes: breakDuration,
      note,
      synced_at: new Date().toISOString(),
    };
    if (lww.status === "apply") {
      updatePayload.client_updated_at = lww.clientUpdatedAt;
    }

    const { data, error } = await supabase
      .from("time_entries")
      .update(updatePayload)
      .eq("id", openEntry.id)
      .eq("user_id", auth.user.id)
      .is("clock_out", null)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ entry: data as TimeEntry });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
