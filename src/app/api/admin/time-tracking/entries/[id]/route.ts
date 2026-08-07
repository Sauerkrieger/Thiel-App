import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, lwwConflictResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { checkLww, parseClientUpdatedAt } from "@/lib/lww";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/admin/time-tracking/entries/[id] – Arbeitszeit freigeben/ablehnen. */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen Arbeitszeiten prüfen." }, { status: 403 });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.is_approved !== "boolean") {
      return NextResponse.json({ error: "is_approved fehlt." }, { status: 400 });
    }
    const lww = await checkLww(getSupabaseAdmin(), "time_entries", id, body.client_updated_at);
    if (lww.status === "conflict") return lwwConflictResponse(lww.serverRecord);
    const payload: Database["public"]["Tables"]["time_entries"]["Update"] = {
      is_approved: body.is_approved,
      synced_at: new Date().toISOString(),
    };
    const timestamp = parseClientUpdatedAt(body.client_updated_at);
    if (timestamp) payload.client_updated_at = timestamp;
    const { data, error } = await getSupabaseAdmin()
      .from("time_entries")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ entry: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** DELETE /api/admin/time-tracking/entries/[id] – nachgereichten Eintrag löschen (Ablehnung). */
export async function DELETE(
  _request: Request,
  { params }: Context,
) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen Arbeitszeiten löschen." }, { status: 403 });

  try {
    const { id } = await params;
    const { error } = await getSupabaseAdmin()
      .from("time_entries")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
