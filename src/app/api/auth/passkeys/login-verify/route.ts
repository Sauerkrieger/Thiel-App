import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRpConfig, verifyLogin } from "@/lib/webauthn";
import { emailToUsername } from "@/lib/auth";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export const dynamic = "force-dynamic";

/** POST /api/auth/passkeys/login-verify – verifiziert die Passkey-Assertion & meldet an. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const response = body.response as AuthenticationResponseJSON | undefined;
    if (!response || !response.id || !response.response) {
      return NextResponse.json(
        { error: "Ungültige Login-Antwort." },
        { status: 400 },
      );
    }

    const rp = getRpConfig(request);
    const admin = getSupabaseAdmin();

    // Passkey zur Credential-ID laden.
    const { data: passkey, error: passkeyError } = await admin
      .from("passkeys")
      .select("id, user_id, credential_id, public_key, counter, transports")
      .eq("credential_id", response.id)
      .maybeSingle();
    if (passkeyError) throw passkeyError;
    if (!passkey) {
      return NextResponse.json(
        { error: "Kein Passkey für diese Anmeldung gefunden." },
        { status: 404 },
      );
    }

    // Login-Challenge anhand der vom Client zurückgegebenen challenge_id holen.
    const challengeId =
      typeof body.challenge_id === "string" ? body.challenge_id : "";
    if (!challengeId) {
      return NextResponse.json(
        { error: "Keine gültige Challenge gefunden. Bitte erneut versuchen." },
        { status: 400 },
      );
    }
    const { data: challenge, error: challengeError } = await admin
      .from("webauthn_challenges")
      .select("id, challenge")
      .eq("id", challengeId)
      .eq("purpose", "authentication")
      .is("user_id", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (challengeError) throw challengeError;
    if (!challenge) {
      return NextResponse.json(
        { error: "Keine gültige Challenge gefunden. Bitte erneut versuchen." },
        { status: 400 },
      );
    }

    const verification = await verifyLogin({
      rp,
      response,
      expectedChallenge: challenge.challenge,
      credential: {
        credential_id: passkey.credential_id,
        public_key: passkey.public_key,
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    if (!verification.verified) {
      return NextResponse.json(
        { error: "Passkey konnte nicht verifiziert werden." },
        { status: 400 },
      );
    }

    // Challenge aufbrauchen + Zähler aktualisieren.
    await admin.from("webauthn_challenges").delete().eq("id", challenge.id);
    await admin
      .from("passkeys")
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", passkey.id);

    // Nutzerdaten laden.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, name, role, email")
      .eq("id", passkey.user_id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.email) {
      return NextResponse.json(
        { error: "Benutzerkonto nicht gefunden." },
        { status: 404 },
      );
    }

    // Session erzeugen (Passkey hat kein Passwort – Magic-Link-Token verwenden).
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: profile.email,
      });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      return NextResponse.json(
        { error: "Anmeldung fehlgeschlagen (Session konnte nicht erstellt werden)." },
        { status: 500 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (otpError || !otpData.user) {
      return NextResponse.json(
        { error: "Anmeldung fehlgeschlagen." },
        { status: 500 },
      );
    }

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
      { error: "Passkey-Login fehlgeschlagen." },
      { status: 500 },
    );
  }
}
