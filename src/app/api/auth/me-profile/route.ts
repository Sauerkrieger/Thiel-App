import { NextResponse } from "next/server";
import { requireUser, usernameToEmail, emailToUsername } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkLww } from "@/lib/lww";
import { lwwConflictResponse } from "@/lib/http";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

/** PATCH /api/auth/me-profile – eigenen Benutzernamen & Anzeigenamen ändern. */
export async function PATCH(request: Request) {
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
    const username =
      typeof body.username === "string" ? body.username.trim() : null;
    const name = typeof body.name === "string" ? body.name.trim() : null;

    if (!username && !name) {
      return NextResponse.json(
        { error: "Keine Änderungen übermittelt." },
        { status: 400 },
      );
    }
    if (username && !/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Der Benutzername darf nur Buchstaben, Zahlen, Punkt, Strich und Unterstrich enthalten." },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    // Last-Write-Wins auf dem eigenen Profil (Offline-Sync-Schutz).
    // Muss VOR allen Schreiboperationen laufen (auch der auth.users-E-Mail-
    // Änderung), damit ein Konflikt die Anfrage atomar ablehnt.
    const lww = await checkLww(admin, "profiles", user.id, body.client_updated_at);
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
    }

    let newEmail = user.email;
    if (username) {
      newEmail = usernameToEmail(username);

      // Duplikat-Prüfung (andere Nutzer mit derselben E-Mail).
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .eq("email", newEmail)
        .neq("id", user.id)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: `Der Benutzername „${username}“ ist bereits vergeben.` },
          { status: 409 },
        );
      }

      // Auth-User-E-Mail ändern (Login-Kennung).
      const { error: authError } = await admin.auth.admin.updateUserById(
        user.id,
        { email: newEmail, email_confirm: true },
      );
      if (authError) throw authError;
    }

    // Profil aktualisieren.
    const update: {
      name?: string;
      email?: string;
    } = {};
    if (name) update.name = name;
    if (newEmail) update.email = newEmail;

    const updatePayload: Database["public"]["Tables"]["profiles"]["Update"] = {
      ...update,
    };
    if (lww.status === "apply") {
      updatePayload.client_updated_at = lww.clientUpdatedAt;
    }
    updatePayload.synced_at = new Date().toISOString();

    const { data: profile, error } = await admin
      .from("profiles")
      .update(updatePayload)
      .eq("id", user.id)
      .select("id, name, role, email")
      .single();
    if (error) throw error;

    return NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        username: emailToUsername(profile.email),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Profil konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
