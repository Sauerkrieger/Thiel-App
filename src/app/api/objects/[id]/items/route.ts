import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseItemInput } from "@/lib/items";
import { requireUser, isFacilityManager } from "@/lib/auth";
import { parseClientUpdatedAt } from "@/lib/lww";
import type { Database } from "@/types/database";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Objektbetreuer: Items nur zugewiesener Objekte lesen.
    if (isFacilityManager(auth.user)) {
      const { data: assignment } = await supabase
        .from("object_assignments")
        .select("object_id")
        .eq("user_id", auth.user.id)
        .eq("object_id", id)
        .maybeSingle();
      if (!assignment) {
        return NextResponse.json(
          { error: "Objekt nicht gefunden." },
          { status: 404 },
        );
      }
    }

    const { data, error } = await supabase
      .from("object_items")
      .select("*")
      .eq("object_id", id)
      .order("is_always_required", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ items: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function POST(request: Request, { params }: Context) {
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
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const item = parseItemInput(body);

    if (!item) {
      return NextResponse.json(
        { error: "Ungültiges Item: Bezeichnung erforderlich, Menge muss eine positive Zahl sein." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    const insertPayload: Database["public"]["Tables"]["object_items"]["Insert"] = {
      object_id: id,
      item_name: item.item_name,
      quantity: item.quantity,
      note: item.note,
      photo_path: item.photo_path,
      is_always_required: item.is_always_required,
      is_reserved: item.is_reserved,
    };
    if (clientUpdatedAt) {
      insertPayload.created_at = clientUpdatedAt;
      insertPayload.updated_at = clientUpdatedAt;
      insertPayload.client_updated_at = clientUpdatedAt;
    }
    insertPayload.synced_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("object_items")
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
