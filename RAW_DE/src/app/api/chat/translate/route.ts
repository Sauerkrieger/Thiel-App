import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";
import { translateText } from "@/lib/gemini-chat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const messageId = typeof body.message_id === "string" ? body.message_id : "";
    const language = typeof body.language === "string" ? body.language.trim().slice(0, 40) : "";
    if (!messageId || !language) return NextResponse.json({ error: "Nachricht und Sprache sind erforderlich." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: message, error } = await admin.from("chat_messages").select("id, thread_id, body, transcript, sender_id").eq("id", messageId).single();
    if (error) throw error;
    const { data: thread, error: threadError } = await admin.from("chat_threads").select("employee_id, admin_id").eq("id", message.thread_id).single();
    if (threadError) throw threadError;
    if (thread.employee_id !== auth.user.id && thread.admin_id !== auth.user.id) return NextResponse.json({ error: "Kein Zugriff." }, { status: 403 });
    const sourceText = message.body ?? message.transcript;
    if (!sourceText) return NextResponse.json({ error: "Diese Nachricht enthält keinen Text." }, { status: 400 });
    const { data: existing } = await admin.from("chat_translations").select("translated_body").eq("message_id", messageId).eq("language", language).maybeSingle();
    if (existing) return NextResponse.json({ translation: existing.translated_body });
    const translation = await translateText(sourceText, language);
    const { error: insertError } = await admin.from("chat_translations").insert({ message_id: messageId, language, translated_body: translation });
    if (insertError) throw insertError;
    return NextResponse.json({ translation });
  } catch (error) { return apiErrorResponse(error); }
}
