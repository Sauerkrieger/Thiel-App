import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { checkLww, parseClientUpdatedAt } from "@/lib/lww";
import { notifySubstitutePush } from "@/lib/substitute-notify";
import { isTimeOffStatus } from "../route";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/time-tracking/requests/[id] – Antrag freigeben/ablehnen. */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen Anträge bearbeiten." }, { status: 403 });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isTimeOffStatus(body.status)) {
      return NextResponse.json({ error: "Ungültiger Antragsstatus." }, { status: 400 });
    }
    const lww = await checkLww(getSupabaseAdmin(), "time_off_requests", id, body.client_updated_at);
    if (lww.status === "conflict") return lwwConflictResponse(lww.serverRecord);

    const note = typeof body.reviewer_note === "string" ? body.reviewer_note.trim().slice(0, 1000) || null : null;
    const payload: Database["public"]["Tables"]["time_off_requests"]["Update"] = {
      status: body.status,
      reviewer_note: note,
      synced_at: new Date().toISOString(),
    };

    // Vorher-Stand merken: wird gebraucht, um dem Springer eine Push-
    // Benachrichtigung zu schicken, wenn die Vertretung neu eingetragen,
    // geändert oder der Hinweis aktualisiert wurde.
    const { data: current, error: currentError } = await getSupabaseAdmin()
      .from("time_off_requests")
      .select("user_id, status, substitute_id, reviewer_note")
      .eq("id", id)
      .single();
    if (currentError) throw currentError;

    if (body.substitute_id !== undefined) {
      const substituteId = typeof body.substitute_id === "string" && body.substitute_id.trim()
        ? body.substitute_id.trim()
        : null;
      if (substituteId === current.user_id) {
        return NextResponse.json({ error: "Die Vertretung darf nicht der Antragsteller sein." }, { status: 400 });
      }
      if (substituteId) {
        const { data: substitute, error: substituteError } = await getSupabaseAdmin()
          .from("profiles")
          .select("id")
          .eq("id", substituteId)
          .maybeSingle();
        if (substituteError) throw substituteError;
        if (!substitute) return NextResponse.json({ error: "Der gewählte Vertreter existiert nicht." }, { status: 400 });
      }
      payload.substitute_id = substituteId;
    }
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    if (clientUpdatedAt) payload.client_updated_at = clientUpdatedAt;
    const { data, error } = await getSupabaseAdmin()
      .from("time_off_requests")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    // Push an den Springer: sobald die Vertretung genehmigt ist und neu
    // eingetragen wurde, die Vertretungsperson wechselte oder der Hinweis
    // sich geändert hat (idempotentes erneutes Speichern schickt nichts).
    const updated = data as {
      status: string;
      start_date: string;
      end_date: string;
      substitute_id: string | null;
    };
    const substituteChanged =
      payload.substitute_id !== undefined &&
      payload.substitute_id !== current.substitute_id;
    const noteChanged = note !== current.reviewer_note;
    const becameApproved = current.status !== "approved" && updated.status === "approved";
    if (updated.substitute_id && updated.status === "approved" && (becameApproved || substituteChanged || noteChanged)) {
      const { data: absent } = await getSupabaseAdmin()
        .from("profiles")
        .select("name")
        .eq("id", current.user_id)
        .maybeSingle();
      await notifySubstitutePush({
        substituteId: updated.substitute_id,
        absentName: absent?.name ?? "Mitarbeiter",
        startDate: updated.start_date,
        endDate: updated.end_date,
        updated: !becameApproved && !substituteChanged,
      }).catch(() => {});
    }

    return NextResponse.json({ request: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
