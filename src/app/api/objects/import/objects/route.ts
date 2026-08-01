import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse, isObjectCategory } from "@/lib/http";
import { findDuplicate, normalizeAddress } from "@/lib/ocr";
import { requireUser, isAdmin } from "@/lib/auth";
import type { ImportResult, ObjectImportInput } from "@/types/api";

export const dynamic = "force-dynamic";

const MAX_OBJECTS = 500;

/** POST /api/objects/import/objects -> bestätigte Objekte anlegen (Duplikate überspringen). */
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
      { error: "Nur Admins dürfen Objekte importieren." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawObjects = Array.isArray(body.objects) ? body.objects : [];

    if (rawObjects.length === 0) {
      return NextResponse.json(
        { error: "Keine Objekte übermittelt." },
        { status: 400 },
      );
    }
    if (rawObjects.length > MAX_OBJECTS) {
      return NextResponse.json(
        { error: `Maximal ${MAX_OBJECTS} Objekte erlaubt.` },
        { status: 400 },
      );
    }

    // Eingaben validieren und bereinigen.
    const inputs: ObjectImportInput[] = [];
    for (const raw of rawObjects) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const address = typeof r.address === "string" ? r.address.trim() : "";
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!address) continue;
      inputs.push({
        name: name || address,
        address,
        category: isObjectCategory(r.category) ? r.category : "objekt",
        is_pedestrian_zone_until_11: Boolean(r.is_pedestrian_zone_until_11),
        opens_at:
          typeof r.opens_at === "string" && r.opens_at ? r.opens_at : null,
      });
    }

    if (inputs.length === 0) {
      return NextResponse.json(
        { error: "Ungültige Objekte übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: existingRows, error: existingError } = await supabase
      .from("objects")
      .select("id, name, address");

    if (existingError) throw existingError;
    const existingAddresses = (existingRows ?? []).map((row) =>
      normalizeAddress(row.address),
    );

    const result: ImportResult = {
      total: inputs.length,
      created: [],
      duplicates: [],
      errors: [],
    };

    for (const input of inputs) {
      const normalized = normalizeAddress(input.address);

      if (normalized.length < 5) {
        result.errors.push(input.address);
        continue;
      }

      const duplicate = findDuplicate(normalized, existingAddresses);
      if (duplicate) {
        result.duplicates.push({ address: input.address, matched: duplicate });
        continue;
      }

      const { data, error } = await supabase
        .from("objects")
        .insert({
          name: input.name,
          address: input.address,
          category: input.category,
          is_pedestrian_zone_until_11: input.is_pedestrian_zone_until_11,
          opens_at: input.opens_at,
        })
        .select()
        .single();

      if (error) {
        result.errors.push(input.address);
        continue;
      }
      result.created.push(data);
      existingAddresses.push(normalized);
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
