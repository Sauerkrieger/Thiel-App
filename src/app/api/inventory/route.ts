import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_NAME = 200;
const MAX_NOTE = 500;

/** GET /api/inventory -> alle Items des Inventars (alphabetisch). */
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
      .from("inventory_items")
      .select("id, name, note, created_at, updated_at")
      .order("name");
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

/** POST /api/inventory -> neues Inventar-Item anlegen (nur Admin). */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Inventar-Items anlegen." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const raw = body as Record<string, unknown>;

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > MAX_NAME) {
      return NextResponse.json(
        { error: "Ungültiger Item-Name." },
        { status: 400 },
      );
    }
    let note: string | null = null;
    if (typeof raw.note === "string") {
      const trimmed = raw.note.trim();
      if (trimmed) {
        if (trimmed.length > MAX_NOTE) {
          return NextResponse.json(
            { error: "Anmerkung ist zu lang." },
            { status: 400 },
          );
        }
        note = trimmed;
      }
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("inventory_items")
      .insert({ name, note })
      .select("id, name, note, created_at, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
