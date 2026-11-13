import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRpConfig, generateLoginOptions } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

/** POST /api/auth/passkeys/login-options – beginnt den Passkey-Login (öffentlich). */
export async function POST(request: Request) {
  try {
    const rp = getRpConfig(request);
    const options = await generateLoginOptions(rp);

    const admin = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: challengeRow, error: challengeError } = await admin
      .from("webauthn_challenges")
      .insert({
        challenge: options.challenge,
        user_id: null,
        purpose: "authentication",
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (challengeError) throw challengeError;

    // challenge_id wird an den Client gegeben und bei der Verifikation
    // zurückerwartet – so kann keine andere Login-Session die Challenge
    // versehentlich konsumieren (Race-Schutz bei parallelen Logins).
    return NextResponse.json({ options, challenge_id: challengeRow.id });
  } catch {
    return NextResponse.json(
      { error: "Passkey-Login konnte nicht gestartet werden." },
      { status: 500 },
    );
  }
}
