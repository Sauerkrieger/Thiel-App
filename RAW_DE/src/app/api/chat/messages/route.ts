import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";
import { transcribeAudio } from "@/lib/gemini-chat";
import { sendChatPush } from "@/app/api/chat/push/send";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 15 * 1024 * 1024;

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const threadId = new URL(request.url).searchParams.get("thread_id");
    if (!threadId) return NextResponse.json({ error: "thread_id fehlt." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: thread, error: threadError } = await admin.from("chat_threads").select("*").eq("id", threadId).single();
    if (threadError) throw threadError;
    if (thread.employee_id !== auth.user.id && thread.admin_id !== auth.user.id) return NextResponse.json({ error: "Kein Zugriff auf diesen Chat." }, { status: 403 });
    const { data, error } = await admin.from("chat_messages").select("*").eq("thread_id", threadId).order("created_at");
    if (error) throw error;
    const unread = (data ?? []).filter((message) => message.sender_id !== auth.user.id && message.status !== "read").map((message) => message.id);
    if (unread.length) await admin.from("chat_messages").update({ status: "read", read_at: new Date().toISOString() }).in("id", unread);
    const messagesWithUrls = await Promise.all((data ?? []).map(async (message) => {
      const mediaUrl = message.media_path
        ? (await admin.storage.from("chat-media").createSignedUrl(message.media_path, 60 * 60)).data?.signedUrl ?? null
        : null;
      return { ...message, media_url: mediaUrl, status: message.sender_id === auth.user.id ? message.status : "read" };
    }));
    return NextResponse.json({ messages: messagesWithUrls });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const form = await request.formData();
    const threadId = String(form.get("thread_id") ?? "");
    const body = String(form.get("body") ?? "").trim();
    const kind = String(form.get("kind") ?? "text");
    const urgent = form.get("is_urgent") === "true";
    const file = form.get("file");
    if (!threadId || !["text", "image", "audio"].includes(kind)) return NextResponse.json({ error: "Ungültige Nachricht." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: thread, error: threadError } = await admin.from("chat_threads").select("*").eq("id", threadId).single();
    if (threadError) throw threadError;
    if (thread.employee_id !== auth.user.id && thread.admin_id !== auth.user.id) return NextResponse.json({ error: "Kein Zugriff auf diesen Chat." }, { status: 403 });
    if (!body && !(file instanceof File)) return NextResponse.json({ error: "Nachricht ist leer." }, { status: 400 });
    let mediaPath: string | null = null;
    let mediaMimeType: string | null = null;
    let transcript: string | null = null;
    if (file instanceof File) {
      if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Datei ist zu groß (max. 15 MB)." }, { status: 400 });
      mediaMimeType = file.type;
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      mediaPath = `messages/${threadId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await admin.storage.from("chat-media").upload(mediaPath, fileBuffer, { contentType: file.type, upsert: false });
      if (error) throw error;
      if (kind === "audio") {
        transcript = await transcribeAudio(fileBuffer, file.type);
      }
    }
    const { data, error } = await admin.from("chat_messages").insert({ thread_id: threadId, sender_id: auth.user.id, kind: kind as "text" | "image" | "audio", body: body || null, media_path: mediaPath, media_mime_type: mediaMimeType, transcript, is_urgent: urgent && isAdmin(auth.user), status: "sent" }).select("*").single();
    if (error) throw error;
    const recipientId = thread.employee_id === auth.user.id ? thread.admin_id : thread.employee_id;
    const preview = body || transcript || (kind === "image" ? "Bildnachricht" : "Sprachnachricht");
    void sendChatPush(recipientId, auth.user.name, preview);
    return NextResponse.json({ message: data }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const messageId = typeof body.message_id === "string" ? body.message_id : "";
    const action = body.action;
    const admin = getSupabaseAdmin();
    const { data: message, error: messageError } = await admin.from("chat_messages").select("*").eq("id", messageId).single();
    if (messageError) throw messageError;
    const { data: thread, error: threadError } = await admin.from("chat_threads").select("employee_id, admin_id").eq("id", message.thread_id).single();
    if (threadError) throw threadError;
    const participant = thread.employee_id === auth.user.id || thread.admin_id === auth.user.id;
    if (!participant) return NextResponse.json({ error: "Kein Zugriff." }, { status: 403 });
    if (action === "delivered" && message.sender_id !== auth.user.id) {
      const { data } = await admin.from("chat_messages").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", messageId).select("*").single();
      return NextResponse.json({ message: data });
    }
    if (action === "read" && message.sender_id !== auth.user.id) {
      const { data } = await admin.from("chat_messages").update({ status: "read", read_at: new Date().toISOString() }).eq("id", messageId).select("*").single();
      return NextResponse.json({ message: data });
    }
    if (action === "understood" && message.is_urgent && message.sender_id !== auth.user.id) {
      const { data } = await admin.from("chat_messages").update({ understood_at: new Date().toISOString() }).eq("id", messageId).select("*").single();
      return NextResponse.json({ message: data });
    }
    return NextResponse.json({ error: "Ungültige Statusaktion." }, { status: 400 });
  } catch (error) { return apiErrorResponse(error); }
}
