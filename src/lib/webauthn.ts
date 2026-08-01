import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

/** RP-Konfiguration, abgeleitet aus dem Request (Host/Origin). */
export type RpConfig = {
  rpID: string;
  origin: string;
  rpName: string;
};

/**
 * Baut die RP-Konfiguration aus dem eingehenden Request.
 * In Produktion (Vercel) ist der Host z. B. "thiel-app.vercel.app",
 * lokal "localhost:3000".
 */
export function getRpConfig(request: Request): RpConfig {
  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const rpID = process.env.WEBAUTHN_RP_ID ?? host.split(":")[0];
  return {
    rpID,
    origin: `${protocol}://${host}`,
    rpName: process.env.WEBAUTHN_RP_NAME ?? "Thiel Dienstleistungen",
  };
}

/** Gespeicherter Passkey-Datensatz aus der DB. */
export type StoredPasskey = {
  credential_id: string;
  public_key: string; // base64url
  counter: number;
  transports: unknown;
};

const VALID_TRANSPORTS: AuthenticatorTransportFuture[] = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
];

/** Wandelt die JSONB-Transports aus der DB in ein gültiges Array um. */
export function parseTransports(value: unknown): AuthenticatorTransportFuture[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is AuthenticatorTransportFuture =>
      typeof t === "string" && (VALID_TRANSPORTS as string[]).includes(t),
  );
}

/** StoredPasskey -> WebAuthnCredential für die Assertion-Verifikation. */
export function toWebAuthnCredential(pk: StoredPasskey): WebAuthnCredential {
  return {
    id: pk.credential_id,
    publicKey: Buffer.from(pk.public_key, "base64url"),
    counter: pk.counter,
    transports: parseTransports(pk.transports),
  };
}

/** Base64URL (öffentlicher Schlüssel) -> Uint8Array für die Speicherung. */
export function publicKeyToBase64Url(key: Uint8Array): string {
  return Buffer.from(key).toString("base64url");
}

/**
 * Generiert Registrierungs-Optionen für einen angemeldeten Nutzer.
 * excludeCredentials verhindert Duplikate bereits registrierter Passkeys.
 */
export async function generateRegistrationOptionsForUser(params: {
  rp: RpConfig;
  user: { id: string; email: string | null; name: string };
  existingCredentials: string[]; // credential_ids
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: params.rp.rpName,
    rpID: params.rp.rpID,
    userName: params.user.email ?? params.user.name ?? params.user.id,
    userDisplayName: params.user.name || params.user.email || "Benutzer",
    userID: Buffer.from(params.user.id, "utf-8"),
    attestationType: "none",
    excludeCredentials: params.existingCredentials.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
}

/** Verifiziert eine Registrierungs-Antwort und liefert die Credential-Daten. */
export async function verifyRegistration(params: {
  rp: RpConfig;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}) {
  const result = await verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.rp.origin,
    expectedRPID: params.rp.rpID,
    requireUserVerification: true,
  });
  return result;
}

/** Generiert Login-Optionen (discoverable credentials, kein Nutzer nötig). */
export async function generateLoginOptions(
  rp: RpConfig,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "preferred",
  });
}

/** Verifiziert eine Login-Antwort (Assertion) gegen den gespeicherten Passkey. */
export async function verifyLogin(params: {
  rp: RpConfig;
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  credential: StoredPasskey;
}) {
  const result = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.rp.origin,
    expectedRPID: params.rp.rpID,
    credential: toWebAuthnCredential(params.credential),
    requireUserVerification: true,
  });
  return result;
}
