import { NextResponse } from "next/server";
import { requireUser, isAdmin, usernameToEmail, emailToUsername, isUserRole } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { parseClientUpdatedAt } from "@/lib/lww";
import type { Database, Profile } from "@/types/database";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

/** GET /api/auth/users – Liste aller Nutzer (nur Admin). */
export async function GET() {
  const result = await requireUser();
  if (!result.user) return unauthorized(result);
  if (!isAdmin(result.user)) return forbidden();

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("profiles")
      .select("id, name, role, email, created_at")
      .order("name");

    if (error) throw error;

    const users = (data as Profile[]).map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      username: emailToUsername(p.email),
      created_at: p.created_at,
    }));

    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ error: "Nutzer konnten nicht geladen werden." }, { status: 500 });
  }
}

/** POST /api/auth/users – neuen Nutzer anlegen (nur Admin). */
export async function POST(request: Request) {
  const result = await requireUser();
  if (!result.user) return unauthorized(result);
  if (!isAdmin(result.user)) return forbidden();

  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : username;
    const password = typeof body.password === "string" ? body.password : "";
    const role = isUserRole(body.role) ? body.role : "driver";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Benutzername und Passwort sind Pflichtfelder." },
        { status: 400 },
      );
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Der Benutzername darf nur Buchstaben, Zahlen, Punkt, Strich und Unterstrich enthalten." },
        { status: 400 },
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` },
        { status: 400 },
      );
    }

    const email = usernameToEmail(username);

    // Duplikat-Prüfung
    const admin = getSupabaseAdmin();
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `Der Benutzername "${username}" ist bereits vergeben.` },
        { status: 409 },
      );
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });
    if (error) throw error;

    // Profil direkt pflegen (Trigger setzt name/role aus metadata).
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    const profilePayload: Database["public"]["Tables"]["profiles"]["Update"] = {
      name,
      role,
      email,
    };
    if (clientUpdatedAt) {
      profilePayload.client_updated_at = clientUpdatedAt;
    }
    profilePayload.synced_at = new Date().toISOString();
    await admin.from("profiles").update(profilePayload).eq("id", created.user.id);

    return NextResponse.json(
      {
        user: {
          id: created.user.id,
          email,
          name,
          role,
          username: emailToUsername(email),
          created_at: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: "Nutzer konnte nicht angelegt werden." }, { status: 500 });
  }
}

function unauthorized(result: { error: string; code: string }) {
  return NextResponse.json({ error: result.error, code: result.code }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "Nur Admins dürfen das." }, { status: 403 });
}
