"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Fingerprint, Loader2, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // WebAuthn-Fähigkeit erst nach dem Mount prüfen: Beim SSR ist window
  // undefined (→ false), im Browser kann sie true sein. Ein Render-Zeit-Check
  // würde sonst das disabled-Attribut des Passkey-Buttons unterschiedlich
  // rendern und einen React-Hydration-Fehler auslösen.
  const [webauthnSupported, setWebauthnSupported] = useState(false);
  useEffect(() => {
    setWebauthnSupported(browserSupportsWebAuthn());
  }, []);

  function goToNext() {
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    router.push(target);
    router.refresh();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Bitte Benutzername und Passwort eingeben.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Anmeldung fehlgeschlagen.");
        return;
      }
      toast.success(`Willkommen, ${data.user?.name ?? username}!`);
      goToNext();
    } catch {
      toast.error("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setPasskeyLoading(true);
    try {
      // 1. Optionen anfordern
      const optionsRes = await fetch("/api/auth/passkeys/login-options", {
        method: "POST",
      });
      const optionsData = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        toast.error(optionsData.error ?? "Passkey-Login konnte nicht gestartet werden.");
        return;
      }

      // 2. Authenticator-Abfrage im Browser
      const assertion = await startAuthentication(optionsData.options);

      // 3. Assertion verifizieren (mit challenge_id gegen Races abgesichert)
      const verifyRes = await fetch("/api/auth/passkeys/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: assertion,
          challenge_id: optionsData.challenge_id,
        }),
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        toast.error(verifyData.error ?? "Passkey-Login fehlgeschlagen.");
        return;
      }
      toast.success(`Willkommen, ${verifyData.user?.name ?? ""}!`);
      goToNext();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        toast.error("Passkey-Abfrage abgebrochen.");
      } else {
        toast.error("Passkey-Login fehlgeschlagen.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-background to-muted/40 p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="items-center pb-2 pt-8 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <Building2 className="h-7 w-7" />
          </span>
          <CardTitle className="text-xl">Thiel Dienstleistungen</CardTitle>
          <CardDescription>
            Melde dich an, um Objekte, Planung und Touren zu verwalten.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Benutzername</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  autoComplete="username"
                  className="pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading || passkeyLoading}
                  autoFocus
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || passkeyLoading}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading || passkeyLoading}>
              {loading ? <Loader2 className="animate-spin" /> : null}
              Anmelden
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">oder</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handlePasskeyLogin}
            disabled={loading || passkeyLoading || !webauthnSupported}
          >
            {passkeyLoading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Fingerprint />
            )}
            Mit Passkey anmelden
          </Button>
          {!webauthnSupported ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Passkeys werden von diesem Browser nicht unterstützt.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
