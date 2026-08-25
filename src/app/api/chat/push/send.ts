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

export async function sendChatPush(recipientId: string, senderName: string, preview: string): Promise<void> {
  if (!configure()) return;
  const supabase = getSupabaseAdmin();
  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", recipientId);
  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: senderName, body: preview.slice(0, 140), url: "/chat" }));
    } catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : 0;
      if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
    }
  }));
}
