import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  GeminiApiNotConfiguredError,
  extractTourListEntries,
  findMatchingObjectIds,
  type ObjectMatchTarget,
} from "@/lib/ocr";
import { requireUser, isPlanner } from "@/lib/auth";
import type { PhotoSelectResult } from "@/types/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** POST /api/planning/photo -> erkannte Einträge mit Objekt-Matches. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isPlanner(auth.user)) {
    return NextResponse.json(
      { error: "Nur Fahrer, Springer und Admins dürfen Touren planen." },
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
    const entries = await extractTourListEntries(
      buffer.toString("base64"),
      file.type,
    );

    const supabase = getSupabaseAdmin();
    const { data: objects, error } = await supabase
      .from("objects")
      .select("id, name, address, customer");

    if (error) throw error;

    const targets: ObjectMatchTarget[] = (objects ?? []).map((obj) => ({
      id: obj.id,
      name: obj.name,
      address: obj.address,
      customer: obj.customer,
    }));

    const result: PhotoSelectResult = { matches: [], unmatched: [] };
    const matchedIds = new Set<string>();

    for (const entry of entries) {
      const matches = findMatchingObjectIds(entry, targets);
      let added = 0;

      for (const match of matches) {
        if (matchedIds.has(match.object_id)) continue;
        matchedIds.add(match.object_id);
        const obj = targets.find((target) => target.id === match.object_id);
        if (!obj) continue;
        result.matches.push({
          object_id: obj.id,
          name: obj.name,
          address: obj.address,
          matched_by: match.matched_by,
        });
        added += 1;
      }

      if (added === 0 && matches.length === 0) {
        result.unmatched.push({
          name: entry.name,
          address: entry.address,
        });
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
