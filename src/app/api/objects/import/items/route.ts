import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { parseItemInputs, type ItemInput } from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";
import type { ItemGroupImportResult } from "@/types/api";

export const dynamic = "force-dynamic";

const MAX_GROUPS = 200;

/** POST /api/objects/import/items -> bestätigte Items-Gruppen übernehmen. */
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
      { error: "Nur Admins dürfen Items importieren." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const groups = Array.isArray(body.groups) ? (body.groups as unknown[]) : [];

    if (groups.length === 0) {
      return NextResponse.json(
        { error: "Keine Items-Gruppen übermittelt." },
        { status: 400 },
      );
    }
    if (groups.length > MAX_GROUPS) {
      return NextResponse.json(
        { error: `Maximal ${MAX_GROUPS} Gruppen erlaubt.` },
        { status: 400 },
      );
    }

    const parsed = groups
      .map((g) => {
        if (typeof g !== "object" || g === null) return null;
        const raw = g as Record<string, unknown>;
        const objectId = typeof raw.object_id === "string" ? raw.object_id : "";
        const items = parseItemInputs(raw.items);
        if (!objectId || !items || items.length === 0) return null;
        return { object_id: objectId, items };
      })
      .filter(
        (g): g is { object_id: string; items: ItemInput[] } => g !== null,
      );

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "Ungültige Items-Gruppen übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const ids = parsed.map((p) => p.object_id);
    const { data: existing, error: existingError } = await supabase
      .from("objects")
      .select("id")
      .in("id", ids);
    if (existingError) throw existingError;
    const existingIds = new Set((existing ?? []).map((o) => o.id));

    const result: ItemGroupImportResult = {
      assigned: 0,
      items_added: 0,
      not_found: 0,
    };

    const toInsert: {
      object_id: string;
      item_name: string;
      quantity: number;
      note: string | null;
    }[] = [];

    for (const p of parsed) {
      if (!existingIds.has(p.object_id)) {
        result.not_found += 1;
        continue;
      }
      for (const item of p.items) {
        toInsert.push({
          object_id: p.object_id,
          item_name: item.item_name,
          quantity: item.quantity,
          note: item.note,
        });
      }
      result.assigned += 1;
    }

    // Items in Batches einfügen.
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      const { error } = await supabase.from("object_items").insert(batch);
      if (error) throw error;
      result.items_added += batch.length;
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
