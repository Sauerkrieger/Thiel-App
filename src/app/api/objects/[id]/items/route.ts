import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseItemInput } from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
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
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Items verwalten." },
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
    const { data, error } = await supabase
      .from("object_items")
      .insert({
        object_id: id,
        item_name: item.item_name,
        quantity: item.quantity,
        note: item.note,
        photo_path: item.photo_path,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
