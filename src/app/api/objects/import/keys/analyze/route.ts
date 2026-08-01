import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  GeminiApiNotConfiguredError,
  extractKeysFromImage,
  findBestObjectByName,
} from "@/lib/ocr";
import { requireUser, isAdmin } from "@/lib/auth";
import type { KeyImportPreview } from "@/types/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** POST /api/objects/import/keys/analyze -> Vorauswahl: Schlüssel -> Objekt-Matches. */
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
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Kein Bild hochgeladen." },
        { status: 400 },
      );
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Die Datei ist kein Bild." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Das Bild ist größer als 10 MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageBase64 = buffer.toString("base64");

    const extracted = await extractKeysFromImage(imageBase64, file.type);
    if (extracted.length === 0) {
      return NextResponse.json({ matches: [], unmatched: [] });
    }

    const supabase = getSupabaseAdmin();
    const { data: objects, error } = await supabase
      .from("objects")
      .select("id, name, address, key_number");
    if (error) throw error;
    const targets = (objects ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      address: o.address,
    }));

    const result: KeyImportPreview = { matches: [], unmatched: [] };

    for (const entry of extracted) {
      const match = findBestObjectByName(entry.name, targets);
      const obj = match
        ? (objects ?? []).find((o) => o.id === match.object_id)
        : null;

      if (obj) {
        result.matches.push({
          object_id: obj.id,
          object_name: obj.name,
          address: obj.address,
          key_number: entry.key_number,
          already_has_key: obj.key_number != null,
        });
      } else {
        result.unmatched.push({ name: entry.name, key_number: entry.key_number });
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GeminiApiNotConfiguredError) {
      return NextResponse.json(
        { error: e.message, code: "GEMINI_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    return apiErrorResponse(e);
  }
}
