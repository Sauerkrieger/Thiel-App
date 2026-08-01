import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRpConfig, verifyRegistration, publicKeyToBase64Url } from "@/lib/webauthn";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

export const dynamic = "force-dynamic";

/** POST /api/auth/passkeys/register-verify – verifiziert & speichert den Passkey. */
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
    const response = body.response as RegistrationResponseJSON | undefined;
    if (!response || !response.id || !response.response) {
      return NextResponse.json(
        { error: "Ungültige Registrierungs-Antwort." },
        { status: 400 },
      );
    }

    const rp = getRpConfig(request);
    const admin = getSupabaseAdmin();

    // Registrierungs-Challenge anhand der challenge_id holen.
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
      .eq("user_id", user.id)
      .eq("purpose", "registration")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (challengeError) throw challengeError;
    if (!challenge) {
      return NextResponse.json(
        { error: "Keine gültige Challenge gefunden. Bitte erneut versuchen." },
        { status: 400 },
      );
    }

    const verification = await verifyRegistration({
      rp,
      response,
      expectedChallenge: challenge.challenge,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: "Registrierung konnte nicht verifiziert werden." },
        { status: 400 },
      );
    }

    const info = verification.registrationInfo;

    // Challenge aufbrauchen.
    await admin.from("webauthn_challenges").delete().eq("id", challenge.id);

    // Passkey speichern.
    const { error: insertError } = await admin.from("passkeys").insert({
      user_id: user.id,
      credential_id: info.credential.id,
      public_key: publicKeyToBase64Url(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
    });
    if (insertError) throw insertError;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Passkey konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
