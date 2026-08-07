import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { ITEM_PHOTOS_BUCKET, itemPhotoUrl } from "@/lib/storage";
import { requireUser, isFacilityManager } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

/** POST /api/items/photo -> Item-Foto in den Storage-Bucket hochladen. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  // Objektbetreuer dürfen Items nicht verändern – auch keine Fotos hochladen.
  if (isFacilityManager(auth.user)) {
    return NextResponse.json(
      { error: "Objektbetreuer dürfen Item-Fotos nicht hochladen." },
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
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Bitte JPG, PNG, WEBP oder HEIC verwenden." },
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
    const path = `items/${crypto.randomUUID()}.${extensionFor(file.type)}`;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage
      .from(ITEM_PHOTOS_BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) throw error;

    return NextResponse.json({
      photo_path: path,
      url: itemPhotoUrl(path),
    });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
