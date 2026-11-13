import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: Request) {
  const result = await requireUser();
  if (!result.user) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status },
    );
  }
  const user = result.user;

  try {
    const body = await request.json().catch(() => ({}));
    const currentPassword =
      typeof body.current_password === "string" ? body.current_password : "";
    const newPassword =
      typeof body.new_password === "string" ? body.new_password : "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Aktuelles und neues Passwort sind Pflichtfelder." },
        { status: 400 },
      );
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` },
        { status: 400 },
      );
    }

    // Aktuelles Passwort verifizieren (Email = Login-Kennung des Nutzers).
    const supabase = await createSupabaseServerClient();
    const email = user.email ?? "";
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      return NextResponse.json(
        { error: "Das aktuelle Passwort ist falsch." },
        { status: 401 },
      );
    }

    const admin = getSupabaseAdmin();
    const { error: updateError } = await admin.auth.admin.updateUserById(
      user.id,
      { password: newPassword },
    );
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Passwort konnte nicht geändert werden." },
      { status: 500 },
    );
  }
}
