import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";
import { transcribeAudio } from "@/lib/gemini-chat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("audio/")) return NextResponse.json({ error: "Keine gültige Audiodatei." }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Audio ist zu groß (max. 15 MB)." }, { status: 400 });
    const transcript = await transcribeAudio(Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ transcript });
  } catch (error) { return apiErrorResponse(error); }
}
