import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin, isFacilityManager } from "@/lib/auth";
import { checkLww } from "@/lib/lww";
import { lwwConflictResponse } from "@/lib/http";
import type { Database } from "@/types/database";

type Context = { params: Promise<{ id: string; itemId: string }> };

// Items bearbeiten (PUT) dürfen inzwischen alle angemeldeten Nutzer außer
// Objektbetreuern (nur Lesen) – das Löschen (DELETE) bleibt Admins vorbehalten.
export async function PUT(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  // Objektbetreuer dürfen Items nur ansehen, nicht ändern.
  if (isFacilityManager(auth.user)) {
    return NextResponse.json(
      { error: "Objektbetreuer dürfen Items nicht bearbeiten." },
      { status: 403 },
    );
  }

  try {
    const { id, itemId } = await params;
    const body = await request.json().catch(() => ({}));

    const update: Database["public"]["Tables"]["object_items"]["Update"] = {};
    if (typeof body.item_name === "string") {
      const itemName = body.item_name.trim();
      if (!itemName) {
        return NextResponse.json(
          { error: "Item-Name darf nicht leer sein." },
          { status: 400 },
        );
      }
      update.item_name = itemName;
    }
    if (body.quantity !== undefined) {
      const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json(
          { error: "Menge muss eine positive ganze Zahl sein." },
          { status: 400 },
        );
      }
      update.quantity = quantity;
    }
    if (body.note !== undefined) {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      update.note = note.length > 0 ? note : null;
    }
    if (body.photo_path !== undefined) {
      const photoPath =
        typeof body.photo_path === "string" ? body.photo_path.trim() : "";
      update.photo_path = photoPath.length > 0 ? photoPath : null;
    }
    if (typeof body.is_always_required === "boolean") {
      update.is_always_required = body.is_always_required;
    }
    if (typeof body.is_reserved === "boolean") {
      update.is_reserved = body.is_reserved;
    }

    const supabase = getSupabaseAdmin();
    const lww = await checkLww(supabase, "object_items", itemId, body.client_updated_at, [
      ["object_id", id],
    ]);
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
    }

    const updatePayload: Database["public"]["Tables"]["object_items"]["Update"] = {
      ...update,
    };
    if (lww.status === "apply") {
      updatePayload.client_updated_at = lww.clientUpdatedAt;
    }
    updatePayload.synced_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("object_items")
      .update(updatePayload)
      .eq("id", itemId)
      .eq("object_id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  // Löschen bleibt Admins vorbehalten.
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Items löschen." },
      { status: 403 },
    );
  }

  try {
    const { id, itemId } = await params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("object_items")
      .delete()
      .eq("id", itemId)
      .eq("object_id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
