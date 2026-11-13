import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const subscription = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    if (typeof subscription?.endpoint !== "string" || typeof subscription.keys?.p256dh !== "string" || typeof subscription.keys.auth !== "string") return NextResponse.json({ error: "Ungültige Push-Subscription." }, { status: 400 });
    const { error } = await getSupabaseAdmin().from("push_subscriptions").upsert({ user_id: auth.user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, user_agent: request.headers.get("user-agent") }, { onConflict: "user_id,endpoint" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return apiErrorResponse(error); }
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.endpoint !== "string") return NextResponse.json({ error: "Endpoint fehlt." }, { status: 400 });
    const { error } = await getSupabaseAdmin().from("push_subscriptions").delete().eq("user_id", auth.user.id).eq("endpoint", body.endpoint);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return apiErrorResponse(error); }
}
