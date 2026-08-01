import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  GeminiApiNotConfiguredError,
  extractAddressesFromImage,
  findDuplicate,
  normalizeAddress,
} from "@/lib/ocr";
import {
  normalizeAddressForGeocoding,
  orsGeocodeSearch,
} from "@/lib/ors";
import { requireUser, isAdmin } from "@/lib/auth";
import type { ObjectImportPreview } from "@/types/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** POST /api/objects/import/objects/analyze -> Vorauswahl: erkannte Objekte (ohne DB-Write). */
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

    const extracted = await extractAddressesFromImage(imageBase64, file.type);

    const supabase = getSupabaseAdmin();
    const { data: existingRows, error: existingError } = await supabase
      .from("objects")
      .select("id, name, address");

    if (existingError) throw existingError;
    const existingAddresses = (existingRows ?? []).map((row) =>
      normalizeAddress(row.address),
    );

    // Adressen parallel per ORS geocoden – das normalisierte ORS-Label
    // wird in der Vorschau angezeigt („die Adresse, die ORS vermutlich meint“).
    const geocoded = await Promise.all(
      extracted.map(async (item) => {
        const hit = await orsGeocodeSearch(
          normalizeAddressForGeocoding(item.address),
        );
        // Explizit typisiert: sonst weitet TS das Literal auf string auf.
        const geocoding_status: "ok" | "not_found" = hit ? "ok" : "not_found";
        return {
          item,
          address: hit?.label ?? item.address,
          latitude: hit?.latitude ?? null,
          longitude: hit?.longitude ?? null,
          geocoding_status,
        };
      }),
    );

    const objects: ObjectImportPreview["objects"] = geocoded.map(
      ({ item, address, latitude, longitude, geocoding_status }) => {
        const normalized = normalizeAddress(address);
        const duplicate = findDuplicate(normalized, existingAddresses);
        return {
          name: item.name?.trim() || address,
          address,
          category: item.category ?? "objekt",
          is_pedestrian_zone_until_11: Boolean(
            item.is_pedestrian_zone_until_11,
          ),
          opens_at: item.opens_at || null,
          is_duplicate: duplicate !== null,
          latitude,
          longitude,
          geocoding_status,
        };
      },
    );

    return NextResponse.json({ objects } satisfies ObjectImportPreview);
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
