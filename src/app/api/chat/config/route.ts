import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const { data, error } = await getSupabaseAdmin().from("company_settings").select("support_phone_number").eq("id", true).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ supportPhoneNumber: data?.support_phone_number ?? null, vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen die Supportnummer ändern." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const phone = typeof body.support_phone_number === "string" ? body.support_phone_number.trim() : "";
    if (phone && !/^[0-9 +()-]+$/.test(phone)) return NextResponse.json({ error: "Ungültige Telefonnummer." }, { status: 400 });
    const { error } = await getSupabaseAdmin().from("company_settings").upsert({ id: true, support_phone_number: phone || null, updated_at: new Date().toISOString() });
    if (error) throw error;
    return NextResponse.json({ supportPhoneNumber: phone || null });
  } catch (error) { return apiErrorResponse(error); }
}
