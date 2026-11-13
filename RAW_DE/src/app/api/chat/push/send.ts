import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

let configured = false;
function configure() {
  if (configured) return true;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/** Nutzdaten einer Push-Nachricht (der Service Worker zeigt sie direkt an). */
export type PushPayload = {
  title: string;
  body: string;
  /** Seite, die beim Tippen auf die Benachrichtigung geöffnet wird. */
  url: string;
  /** Gruppierung: gleiche Tags ersetzen sich gegenseitig (Standard: Chat). */
  tag?: string;
  /** Auch anzeigen, wenn die App gerade sichtbar geöffnet ist. */
  always?: boolean;
};

/**
 * Schickt eine Push-Nachricht an alle Geräte eines Nutzers. Nicht mehr
 * gültige Subscriptions (404/410) werden automatisch entfernt. Tut nichts,
 * wenn Push nicht konfiguriert ist (VAPID env vars fehlen) – Features
 * funktionieren dann weiterhin ohne Benachrichtigung.
 */
export async function sendPushToUser(recipientId: string, payload: PushPayload): Promise<void> {
  if (!configure()) return;
  const supabase = getSupabaseAdmin();
  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", recipientId);
  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: payload.title, body: payload.body.slice(0, 140), url: payload.url, tag: payload.tag ?? "chat-message", always: payload.always === true }));
    } catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : 0;
      if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
    }
  }));
}

export async function sendChatPush(recipientId: string, senderName: string, preview: string): Promise<void> {
  return sendPushToUser(recipientId, { title: senderName, body: preview, url: "/chat" });
}
