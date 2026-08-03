import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const MAX_NAME = 200;
const MAX_NOTE = 500;

/** PUT /api/inventory/[id] -> Inventar-Item bearbeiten (Name/Anmerkung, nur Admin). */
export async function PUT(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Inventar-Items bearbeiten." },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const raw = body as Record<string, unknown>;

    const update: { name?: string; note?: string | null } = {};
    if (raw.name !== undefined) {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name || name.length > MAX_NAME) {
        return NextResponse.json(
          { error: "Ungültiger Item-Name." },
          { status: 400 },
        );
      }
      update.name = name;
    }
    if (raw.note !== undefined) {
      const note =
        typeof raw.note === "string" && raw.note.trim()
          ? raw.note.trim().slice(0, MAX_NOTE)
          : null;
      update.note = note;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Keine gültigen Felder übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("inventory_items")
      .update(update)
      .eq("id", id)
      .select("id, name, note, created_at, updated_at")
      .single();
    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Inventar-Item nicht gefunden." },
          { status: 404 },
        );
      }
      throw error;
    }
    return NextResponse.json({ item: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

/** DELETE /api/inventory/[id] -> Inventar-Item löschen (nur Admin). */
export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Inventar-Items löschen." },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("inventory_items")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
