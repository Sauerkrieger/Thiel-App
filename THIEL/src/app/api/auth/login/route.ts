import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { usernameToEmail, emailToUsername } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Benutzername und Passwort sind Pflichtfelder." },
        { status: 400 },
      );
    }

    const email = usernameToEmail(username);
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return NextResponse.json(
        { error: "Benutzername oder Passwort ist falsch." },
        { status: 401 },
      );
    }

    // Profil für die Antwort laden (Rolle, Name, E-Mail).
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, name, role, email")
      .eq("id", data.user.id)
      .maybeSingle();

    const profileEmail = profile?.email ?? data.user.email ?? null;

    return NextResponse.json({
      user: {
        id: data.user.id,
        email: profileEmail,
        name: profile?.name ?? data.user.user_metadata?.name ?? "",
        role: profile?.role ?? "driver",
        username: emailToUsername(profileEmail),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "Login fehlgeschlagen." }, { status: 500 });
  }
}
