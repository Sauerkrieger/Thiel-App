import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

function isMissingChatTableError(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : String(error ?? "");
  return message.includes("Could not find the table 'public.chat_threads'") || message.includes("relation \"public.chat_threads\" does not exist");
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("chat_threads").select("*").or(`employee_id.eq.${auth.user.id},admin_id.eq.${auth.user.id}`).order("created_at");
    if (error) throw error;
    const ids = [...new Set((data ?? []).flatMap((thread) => [thread.employee_id, thread.admin_id]))];
    const { data: profiles, error: profileError } = await admin.from("profiles").select("id, name, role").in("id", ids);
    if (profileError) throw profileError;
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    return NextResponse.json({ threads: (data ?? []).map((thread) => ({ ...thread, employee: profileById.get(thread.employee_id) ?? null, admin: profileById.get(thread.admin_id) ?? null })) });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const employeeId = typeof body.employee_id === "string" ? body.employee_id : "";
    const adminId = typeof body.admin_id === "string" ? body.admin_id : "";
    if (!employeeId || !adminId || employeeId === adminId) return NextResponse.json({ error: "Ungültige Chat-Teilnehmer." }, { status: 400 });
    if (!isAdmin(auth.user) && employeeId !== auth.user.id) return NextResponse.json({ error: "Mitarbeiter dürfen nur eigene Chats anlegen." }, { status: 403 });
    if (isAdmin(auth.user) && adminId !== auth.user.id) return NextResponse.json({ error: "Der Chat muss deinem Admin-Account zugeordnet sein." }, { status: 403 });
    // Peer-Chat (z. B. Fahrer ↔ Fahrer): das Paar normalisieren, damit beide
    // Seiten unabhängig davon, wer den Chat zuerst öffnet, denselben Thread
    // verwenden (unique(employee_id, admin_id) würde sonst zwei Threads anlegen).
    let normalizedEmployeeId = employeeId;
    let normalizedAdminId = adminId;
    if (!isAdmin(auth.user)) {
      const { data: otherProfile } = await getSupabaseAdmin()
        .from("profiles")
        .select("role")
        .eq("id", adminId)
        .maybeSingle();
      if (otherProfile && otherProfile.role !== "admin" && employeeId.localeCompare(adminId) > 0) {
        normalizedEmployeeId = adminId;
        normalizedAdminId = employeeId;
      }
    }
    const admin = getSupabaseAdmin();
    const { data: existing, error: existingError } = await admin
      .from("chat_threads")
      .select("*")
      .eq("employee_id", normalizedEmployeeId)
      .eq("admin_id", normalizedAdminId)
      .maybeSingle();
    if (existingError && !isMissingChatTableError(existingError)) throw existingError;
    if (existing) return NextResponse.json({ thread: existing });

    const { data, error } = await admin.from("chat_threads").insert({ employee_id: normalizedEmployeeId, admin_id: normalizedAdminId }).select("*").single();
    if (error) {
      if (isMissingChatTableError(error)) {
        return NextResponse.json({ error: "Der Chat ist in der Datenbank noch nicht eingerichtet. Bitte die Chat-Migrationen in Supabase ausführen.", code: "CHAT_MIGRATION_REQUIRED" }, { status: 503 });
      }
      throw error;
    }
    return NextResponse.json({ thread: data }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}
