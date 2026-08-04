"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Fingerprint,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  Shield,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { offlineFetch } from "@/lib/offline/fetch";
import type { UserRole } from "@/types/database";

type CurrentUser = {
  id: string;
  email: string | null;
  name: string;
  role: UserRole;
  username: string;
};

type PasskeyInfo = {
  id: string;
  created_at: string;
  last_used_at: string | null;
};

type UserListItem = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  username: string;
  created_at: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Fahrer",
  facility_manager: "Objektbetreuer",
};

export function SettingsPage({
  user,
  passkeys,
  users,
  isAdmin,
}: {
  user: CurrentUser;
  passkeys: PasskeyInfo[];
  users: UserListItem[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [passkeysState, setPasskeysState] = useState(passkeys);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  async function handleRegisterPasskey() {
    if (!browserSupportsWebAuthn()) {
      toast.error("Passkeys werden von diesem Browser nicht unterstützt.");
      return;
    }
    setPasskeyLoading(true);
    try {
      const optionsRes = await fetch("/api/auth/passkeys/register-options", {
        method: "POST",
      });
      const optionsData = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        toast.error(optionsData.error ?? "Registrierung konnte nicht gestartet werden.");
        return;
      }

      const registration = await startRegistration(optionsData.options);

      const verifyRes = await fetch("/api/auth/passkeys/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: registration,
          challenge_id: optionsData.challenge_id,
        }),
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        toast.error(verifyData.error ?? "Passkey konnte nicht gespeichert werden.");
        return;
      }

      toast.success("Passkey erfolgreich hinterlegt!");
      // Vollreload, damit die neue Passkey-Liste frisch vom Server kommt
      // (useState wird durch router.refresh() nicht aktualisiert).
      window.location.reload();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        toast.error("Registrierung abgebrochen.");
      } else {
        toast.error("Passkey-Registrierung fehlgeschlagen.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    const res = await fetch(`/api/auth/passkeys/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Passkey konnte nicht gelöscht werden.");
      return;
    }
    setPasskeysState((prev) => prev.filter((p) => p.id !== id));
    toast.success("Passkey entfernt.");
  }

  return (
    <div className="container py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
          <p className="text-sm text-muted-foreground">
            Angemeldet als <span className="font-medium text-foreground">{user.name}</span>{" "}
            · <Badge variant="secondary">{ROLE_LABELS[user.role] ?? user.role}</Badge>
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut /> Abmelden
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ProfileSection user={user} />
          <PasswordSection />
        </div>
        <div className="space-y-6">
          <PasskeysSection
            passkeys={passkeysState}
            loading={passkeyLoading}
            onRegister={handleRegisterPasskey}
            onDelete={handleDeletePasskey}
          />
          {isAdmin ? <UsersSection users={users} onChanged={() => router.refresh()} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profil: Benutzernamen ändern                                        */
/* ------------------------------------------------------------------ */

function ProfileSection({ user }: { user: CurrentUser }) {
  const [username, setUsername] = useState(user.username);
  const [name, setName] = useState(user.name);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!username.trim()) {
      toast.error("Bitte einen Benutzernamen eingeben.");
      return;
    }
    setLoading(true);
    try {
      const res = await offlineFetch("/api/auth/me-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Profil konnte nicht gespeichert werden.");
        return;
      }
      toast.success("Profil gespeichert.");
      window.location.reload();
    } catch {
      toast.error("Profil konnte nicht gespeichert werden.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5 text-primary" /> Profil
        </CardTitle>
        <CardDescription>
          Benutzername und Anzeigename für deinen Account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">Benutzername (Login)</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="z. B. Leon"
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Wird in „{username || "…"}@thiel.local“ umgewandelt.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Anzeigename</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Leon"
            disabled={loading}
          />
        </div>
        <Button onClick={handleSave} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Speichern
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Passwort ändern                                                     */
/* ------------------------------------------------------------------ */

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      toast.error("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (next !== confirm) {
      toast.error("Die Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Passwort konnte nicht geändert werden.");
        return;
      }
      toast.success("Passwort geändert.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      toast.error("Passwort konnte nicht geändert werden.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Passwort ändern
        </CardTitle>
        <CardDescription>Lege ein neues Passwort für deinen Account fest.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current">Aktuelles Passwort</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">Neues Passwort</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Neues Passwort wiederholen</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            Passwort ändern
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Passkeys                                                            */
/* ------------------------------------------------------------------ */

function PasskeysSection({
  passkeys,
  loading,
  onRegister,
  onDelete,
}: {
  passkeys: PasskeyInfo[];
  loading: boolean;
  onRegister: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-5 w-5 text-primary" /> Passkeys &amp; Biometrie
        </CardTitle>
        <CardDescription>
          Melde dich bequem mit Fingerabdruck oder Face ID an.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Passkeys hinterlegt.
          </p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((pk) => (
              <li
                key={pk.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Fingerprint className="h-4 w-4 text-muted-foreground" />
                    Passkey
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hinzugefügt {new Date(pk.created_at).toLocaleDateString("de-DE")}
                    {pk.last_used_at
                      ? ` · Zuletzt genutzt ${new Date(pk.last_used_at).toLocaleDateString("de-DE")}`
                      : " · Noch nicht genutzt"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(pk.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button onClick={onRegister} disabled={loading} className="w-full">
          {loading ? <Loader2 className="animate-spin" /> : <Plus />}
          Passkey hinzufügen
        </Button>
        <p className="text-xs text-muted-foreground">
          Dein Browser zeigt dir die System-Dialoge (Fingerabdruck / Face ID).
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Benutzerverwaltung (Admin)                                          */
/* ------------------------------------------------------------------ */

function UsersSection({
  users,
  onChanged,
}: {
  users: UserListItem[];
  onChanged: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("driver");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Benutzername und Passwort sind Pflichtfelder.");
      return;
    }
    if (password.length < 8) {
      toast.error("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    setCreating(true);
    try {
      const res = await offlineFetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), name: name.trim(), password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Nutzer konnte nicht angelegt werden.");
        return;
      }
      toast.success(`Nutzer „${data.user?.name ?? username}“ angelegt.`);
      setUsername("");
      setName("");
      setPassword("");
      setRole("driver");
      onChanged();
    } catch {
      toast.error("Nutzer konnte nicht angelegt werden.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(id: string, newRole: string) {
    setSavingId(id);
    try {
      const res = await offlineFetch(`/api/auth/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Rolle konnte nicht geändert werden.");
        return;
      }
      toast.success("Rolle geändert.");
      onChanged();
    } catch {
      toast.error("Rolle konnte nicht geändert werden.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Nutzer „${name}“ wirklich löschen?`)) return;
    const res = await offlineFetch(`/api/auth/users/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Nutzer konnte nicht gelöscht werden.");
      return;
    }
    toast.success(`Nutzer „${name}“ gelöscht.`);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" /> Benutzerverwaltung
        </CardTitle>
        <CardDescription>
          Lege Konten für Mitarbeiter und Fahrer an und vergib Rollen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleCreate} className="space-y-3 rounded-md border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4 text-primary" /> Neuer Benutzer
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nu-username">Benutzername</Label>
              <Input
                id="nu-username"
                placeholder="z. B. Max"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-name">Anzeigename</Label>
              <Input
                id="nu-name"
                placeholder="z. B. Max Mustermann"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nu-password">Passwort</Label>
              <Input
                id="nu-password"
                type="password"
                placeholder="Mind. 8 Zeichen"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rolle</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="driver">Fahrer</SelectItem>
                  <SelectItem value="facility_manager">Objektbetreuer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : null}
            Benutzer anlegen
          </Button>
        </form>

        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Benutzer vorhanden.</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{u.name}</span>
                    <Badge variant="secondary">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    @{u.username} · Seit{" "}
                    {new Date(u.created_at).toLocaleDateString("de-DE")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={u.role}
                    onValueChange={(v) => handleRoleChange(u.id, v)}
                    disabled={savingId === u.id}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Fahrer</SelectItem>
                      <SelectItem value="facility_manager">Objektbetreuer</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(u.id, u.name)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
