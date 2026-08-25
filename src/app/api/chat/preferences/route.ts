import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const language = typeof body.language === "string" ? body.language.trim().slice(0, 40) : "";
    if (!language) return NextResponse.json({ error: "Sprache fehlt." }, { status: 400 });
    const { error } = await getSupabaseAdmin().from("profiles").update({ chat_preferred_language: language }).eq("id", auth.user.id);
    if (error) throw error;
    return NextResponse.json({ preferredLanguage: language });
  } catch (error) { return apiErrorResponse(error); }
}
