import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getRpConfig,
  generateRegistrationOptionsForUser,
} from "@/lib/webauthn";

export const dynamic = "force-dynamic";

/** POST /api/auth/passkeys/register-options – beginnt die Passkey-Registrierung. */
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
    const rp = getRpConfig(request);
    const admin = getSupabaseAdmin();

    // Bereits registrierte Passkeys des Nutzers (excludeCredentials).
    const { data: existing } = await admin
      .from("passkeys")
      .select("credential_id")
      .eq("user_id", user.id);
    const existingIds = (existing ?? []).map((p) => p.credential_id);

    const options = await generateRegistrationOptionsForUser({
      rp,
      user: { id: user.id, email: user.email, name: user.name },
      existingCredentials: existingIds,
    });

    // Challenge für die Verifikation speichern (10 Min gültig).
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: challengeRow, error: challengeError } = await admin
      .from("webauthn_challenges")
      .insert({
        challenge: options.challenge,
        user_id: user.id,
        purpose: "registration",
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (challengeError) throw challengeError;

    return NextResponse.json({ options, challenge_id: challengeRow.id });
  } catch {
    return NextResponse.json(
      { error: "Passkey-Registrierung konnte nicht gestartet werden." },
      { status: 500 },
    );
  }
}
