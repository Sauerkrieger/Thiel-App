import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const admin = getSupabaseAdmin();
    const languageResult = await admin.from("profiles").select("chat_preferred_language").eq("id", auth.user.id).maybeSingle();
    const contactRoles = isAdmin(auth.user)
      ? (["driver", "facility_manager", "substitute"] as const)
      : (["admin"] as const);
    const withPhone = await admin.from("profiles").select("id, name, role, email, phone").in("role", contactRoles).order("name");
    const result = withPhone.error
      ? await admin.from("profiles").select("id, name, role, email").in("role", contactRoles).order("name")
      : withPhone;
    if (result.error) throw result.error;
    return NextResponse.json({ contacts: result.data ?? [], preferredLanguage: languageResult.data?.chat_preferred_language ?? null });
  } catch (error) { return apiErrorResponse(error); }
}
