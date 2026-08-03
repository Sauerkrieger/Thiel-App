import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import type { KeyImportResult } from "@/types/api";

export const dynamic = "force-dynamic";

const MAX_KEYS = 500;

/** POST /api/objects/import/keys -> bestätigte Schlüssel-Zuordnungen übernehmen. */
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
      { error: "Nur Admins dürfen Schlüssel importieren." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const assignments = Array.isArray(body.assignments)
      ? (body.assignments as unknown[])
      : [];

    if (assignments.length === 0) {
      return NextResponse.json(
        { error: "Keine Schlüssel-Zuordnungen übermittelt." },
        { status: 400 },
      );
    }
    if (assignments.length > MAX_KEYS) {
      return NextResponse.json(
        { error: `Maximal ${MAX_KEYS} Einträge erlaubt.` },
        { status: 400 },
      );
    }

    // Zuordnungen validieren (bestehendes Objekt + Schlüsselnummer)
    const parsed = assignments
      .map((a) => {
        if (typeof a !== "object" || a === null) return null;
        const raw = a as Record<string, unknown>;
        const keyNumber = Number(raw.key_number);
        return {
          object_id: typeof raw.object_id === "string" ? raw.object_id : "",
          key_number:
            Number.isInteger(keyNumber) && keyNumber > 0 ? keyNumber : null,
        };
      })
      .filter(
        (a): a is { object_id: string; key_number: number } =>
          a !== null && a.object_id.length > 0 && a.key_number !== null,
      );

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "Ungültige Schlüssel-Zuordnungen übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const ids = parsed.map((p) => p.object_id);
    const { data: existing, error: objectsError } = await supabase
      .from("objects")
      .select("id, name, address, key_number")
      .in("id", ids);
    if (objectsError) throw objectsError;
    const existingById = new Map((existing ?? []).map((o) => [o.id, o]));

    const result: KeyImportResult = {
      assigned: 0,
      already_had_key: 0,
      not_found: 0,
    };

    const toUpdate: {
      id: string;
      name: string;
      address: string;
      key_number: number;
    }[] = [];

    for (const p of parsed) {
      const obj = existingById.get(p.object_id);
      if (!obj) {
        result.not_found += 1;
      } else if (obj.key_number != null) {
        result.already_had_key += 1;
      } else {
        // Upsert benötigt die Pflichtfelder name/address – wir nutzen die
        // vorhandenen Werte, sodass nur key_number aktualisiert wird.
        toUpdate.push({
          id: obj.id,
          name: obj.name,
          address: obj.address,
          key_number: p.key_number,
        });
      }
    }

    // Schlüsselnummern in Batches setzen (nur Objekte ohne vorhandene Nummer).
    for (let i = 0; i < toUpdate.length; i += 50) {
      const batch = toUpdate.slice(i, i + 50);
      const { error } = await supabase.from("objects").upsert(batch, {
        onConflict: "id",
      });
      if (error) throw error;
      result.assigned += batch.length;
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
