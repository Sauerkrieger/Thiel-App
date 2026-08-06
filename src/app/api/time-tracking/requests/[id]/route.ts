import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { checkLww, parseClientUpdatedAt } from "@/lib/lww";
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
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    if (clientUpdatedAt) payload.client_updated_at = clientUpdatedAt;
    const { data, error } = await getSupabaseAdmin()
      .from("time_off_requests")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ request: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
