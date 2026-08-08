"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Fingerprint,
  KeyRound,
  ListChecks,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { CONTRACT_DEFAULTS, CONTRACT_LABELS, vacationSuggestionFor } from "@/lib/contract";
import { offlineFetch } from "@/lib/offline/fetch";
import type { ContractType, UserRole } from "@/types/database";

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
  contract_type: string;
  weekly_target_hours: number | null;
  working_days_per_week: number | null;
  vacation_days_per_year: number | null;
  object_ids: string[];
};

type ObjectOption = {
  id: string;
  name: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  driver: "Fahrer",
  facility_manager: "Reinigungskraft",
  substitute: "Springer",
};

export function SettingsPage({
  user,
  passkeys,
  users,
  objects,
  isAdmin,
}: {
  user: CurrentUser;
  passkeys: PasskeyInfo[];
  users: UserListItem[];
  objects: ObjectOption[];
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
          {isAdmin ? (
            <UsersSection
              users={users}
              objects={objects}
              onChanged={() => router.refresh()}
            />
          ) : null}
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
  objects,
  onChanged,
}: {
  users: UserListItem[];
  objects: ObjectOption[];
  onChanged: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("driver");
  const [contractType, setContractType] = useState<ContractType>("full_time");
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Soll-Werte des neuen Benutzers (Auto-Fill je Vertragsart, custom manuell).
  const [weeklyTargetHours, setWeeklyTargetHours] = useState("40");
  const [workingDaysPerWeek, setWorkingDaysPerWeek] = useState("5");
  const [vacationDaysPerYear, setVacationDaysPerYear] = useState("30");

  // Objektzuweisung beim Bearbeiten eines Objektbetreuers.
  const [editTarget, setEditTarget] = useState<UserListItem | null>(null);
  const [editObjectIds, setEditObjectIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Individuellen Vertrag (custom) eines bestehenden Nutzers bearbeiten.
  const [editContract, setEditContract] = useState<UserListItem | null>(null);
  const [editWeekly, setEditWeekly] = useState("");
  const [editDays, setEditDays] = useState("");
  const [editVacation, setEditVacation] = useState("");
  const [editContractSaving, setEditContractSaving] = useState(false);

  /** Auto-Fill: Vertragsart gewählt → Soll-Werte vorbefüllen (custom = 40/5/30 Start). */
  function applyContractPreset(type: ContractType) {
    const preset = CONTRACT_DEFAULTS[type];
    setContractType(type);
    setWeeklyTargetHours(String(preset.weekly_target_hours));
    setWorkingDaysPerWeek(String(preset.working_days_per_week));
    setVacationDaysPerYear(String(preset.vacation_days_per_year));
  }

  /** Arbeitstage ändern → Urlaubsanspruch automatisch vorschlagen (custom). */
  function handleDaysChange(
    value: string,
    apply: (v: string) => void,
    applyVacation: (v: string) => void,
  ) {
    apply(value);
    const days = Number(value);
    if (Number.isFinite(days) && days > 0) {
      applyVacation(String(vacationSuggestionFor(days)));
    }
  }

  function toggleObject(id: string) {
    setSelectedObjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleEditObject(id: string) {
    setEditObjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

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
    // Reinigungskräfte müssen beim Anlegen mindestens einem Objekt zugeteilt werden.
    if (role === "facility_manager" && selectedObjectIds.length === 0) {
      toast.error("Bitte mindestens ein Objekt für die Reinigungskraft auswählen.");
      return;
    }
    const weekly = Number(weeklyTargetHours);
    const days = Number(workingDaysPerWeek);
    const vacation = Number(vacationDaysPerYear);
    if (!Number.isFinite(weekly) || weekly <= 0 || weekly > 168) {
      toast.error("Bitte gültige Soll-Stunden pro Woche angeben (1–168).");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 7) {
      toast.error("Bitte gültige Arbeitstage pro Woche angeben (1–7).");
      return;
    }
    if (!Number.isInteger(vacation) || vacation < 0 || vacation > 365) {
      toast.error("Bitte gültige Urlaubstage pro Jahr angeben (0–365).");
      return;
    }
    setCreating(true);
    try {
      const res = await offlineFetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          name: name.trim(),
          password,
          role,
          contract_type: contractType,
          weekly_target_hours: weekly,
          working_days_per_week: days,
          vacation_days_per_year: vacation,
          ...(role === "facility_manager" ? { object_ids: selectedObjectIds } : {}),
        }),
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
      applyContractPreset("full_time");
      setSelectedObjectIds([]);
      onChanged();
    } catch {
      toast.error("Nutzer konnte nicht angelegt werden.");
    } finally {
      setCreating(false);
    }
  }

  /** Rolle ändern – für Reinigungskräfte öffnet sich zuerst der Zuweisungs-Dialog. */
  function handleRoleSelect(id: string, newRole: string) {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    if (newRole === "facility_manager") {
      setEditTarget(user);
      setEditObjectIds(user.object_ids ?? []);
      return;
    }
    void handleRoleChange(id, newRole);
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

  /** Objektzuweisungen einer Reinigungskraft speichern (Rolle + Objekte). */
  async function handleEditSave() {
    if (!editTarget) return;
    if (editObjectIds.length === 0) {
      toast.error("Bitte mindestens ein Objekt für die Reinigungskraft auswählen.");
      return;
    }
    setEditSaving(true);
    try {
      const res = await offlineFetch(`/api/auth/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "facility_manager", object_ids: editObjectIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Objektzuweisung konnte nicht gespeichert werden.");
        return;
      }
      toast.success("Objektzuweisung gespeichert.");
      setEditTarget(null);
      onChanged();
    } catch {
      toast.error("Objektzuweisung konnte nicht gespeichert werden.");
    } finally {
      setEditSaving(false);
    }
  }

  /** Vertragsart eines bestehenden Nutzers ändern (PATCH inkl. Auto-Fill). */
  async function handleContractChange(id: string, contractType: ContractType) {
    const preset = CONTRACT_DEFAULTS[contractType];
    setSavingId(id);
    try {
      const res = await offlineFetch(`/api/auth/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_type: contractType,
          weekly_target_hours: preset.weekly_target_hours,
          working_days_per_week: preset.working_days_per_week,
          vacation_days_per_year: preset.vacation_days_per_year,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Vertragsart konnte nicht geändert werden.");
        return;
      }
      toast.success("Vertragsart geändert.");
      onChanged();
    } catch {
      toast.error("Vertragsart konnte nicht geändert werden.");
    } finally {
      setSavingId(null);
    }
  }

  /** Vertragsart wählen: custom öffnet den Detail-Dialog, sonst direkt speichern. */
  function handleContractSelect(user: UserListItem, value: string) {
    if (value === "custom") {
      setEditContract(user);
      setEditWeekly(String(user.weekly_target_hours ?? 40));
      setEditDays(String(user.working_days_per_week ?? 5));
      setEditVacation(String(user.vacation_days_per_year ?? 30));
      return;
    }
    void handleContractChange(user.id, value as ContractType);
  }

  /** Individuellen Vertrag (custom) eines bestehenden Nutzers speichern. */
  async function handleContractEditSave() {
    if (!editContract) return;
    const weekly = Number(editWeekly);
    const days = Number(editDays);
    const vacation = Number(editVacation);
    if (!Number.isFinite(weekly) || weekly <= 0 || weekly > 168) {
      toast.error("Bitte gültige Soll-Stunden pro Woche angeben (1–168).");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 7) {
      toast.error("Bitte gültige Arbeitstage pro Woche angeben (1–7).");
      return;
    }
    if (!Number.isInteger(vacation) || vacation < 0 || vacation > 365) {
      toast.error("Bitte gültige Urlaubstage pro Jahr angeben (0–365).");
      return;
    }
    setEditContractSaving(true);
    try {
      const res = await offlineFetch(`/api/auth/users/${editContract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_type: "custom",
          weekly_target_hours: weekly,
          working_days_per_week: days,
          vacation_days_per_year: vacation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Vertrag konnte nicht gespeichert werden.");
        return;
      }
      toast.success("Vertrag gespeichert.");
      setEditContract(null);
      onChanged();
    } catch {
      toast.error("Vertrag konnte nicht gespeichert werden.");
    } finally {
      setEditContractSaving(false);
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
                  <SelectItem value="facility_manager">Reinigungskraft</SelectItem>
                  <SelectItem value="substitute">Springer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Vertragsart</Label>
              <Select
                value={contractType}
                onValueChange={(v) => applyContractPreset(v as ContractType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Vollzeit</SelectItem>
                  <SelectItem value="part_time">Teilzeit</SelectItem>
                  <SelectItem value="mini_job">Minijob</SelectItem>
                  <SelectItem value="custom">Individuell</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-vacation">Urlaubstage / Jahr</Label>
              <Input
                id="nu-vacation"
                type="number"
                min={0}
                max={365}
                value={vacationDaysPerYear}
                onChange={(e) => setVacationDaysPerYear(e.target.value)}
                disabled={creating}
              />
              <p className="text-xs text-muted-foreground">
                Jahresurlaub – in allen Vertragsarten manuell anpassbar.
              </p>
            </div>
          </div>

          {/* Individueller Vertrag: Soll-Stunden & Arbeitstage (custom) */}
          {contractType === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nu-weekly">Soll-Stunden / Woche</Label>
                <Input
                  id="nu-weekly"
                  type="number"
                  min={0.5}
                  step="0.5"
                  max={168}
                  value={weeklyTargetHours}
                  onChange={(e) => setWeeklyTargetHours(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nu-days">Arbeitstage / Woche</Label>
                <Input
                  id="nu-days"
                  type="number"
                  min={1}
                  step="0.5"
                  max={7}
                  value={workingDaysPerWeek}
                  onChange={(e) => handleDaysChange(e.target.value, setWorkingDaysPerWeek, setVacationDaysPerYear)}
                  disabled={creating}
                />
                <p className="text-xs text-muted-foreground">
                  Urlaubsanspruch wird automatisch vorgeschlagen.
                </p>
              </div>
            </div>
          )}

          {/* Reinigungskraft: Objektzuweisung (mindestens 1) beim Anlegen */}
          {role === "facility_manager" && (
            <div className="space-y-1.5">
              <Label>
                Zugewiesene Objekte <span className="text-destructive">*</span>
              </Label>
              {objects.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Noch keine Objekte vorhanden – lege zuerst Objekte an.
                </p>
              ) : (
                <>
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                    {objects.map((obj) => (
                      <label
                        key={obj.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/50"
                      >
                        <Checkbox
                          checked={selectedObjectIds.includes(obj.id)}
                          onCheckedChange={() => toggleObject(obj.id)}
                          aria-label={`${obj.name} zuweisen`}
                        />
                        <span className="min-w-0 truncate">{obj.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedObjectIds.length} ausgewählt – die Reinigungskraft sieht nur
                    diese Objekte.
                  </p>
                </>
              )}
            </div>
          )}

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
                    onValueChange={(v) => handleRoleSelect(u.id, v)}
                    disabled={savingId === u.id}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Fahrer</SelectItem>
                      <SelectItem value="facility_manager">Reinigungskraft</SelectItem>
                      <SelectItem value="substitute">Springer</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={u.contract_type ?? "full_time"}
                    onValueChange={(v) => handleContractSelect(u, v)}
                    disabled={savingId === u.id}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONTRACT_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {u.role === "facility_manager" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => {
                        setEditTarget(u);
                        setEditObjectIds(u.object_ids ?? []);
                      }}
                      title={`${(u.object_ids ?? []).length} Objekte zugewiesen`}
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      {(u.object_ids ?? []).length} Objekte
                    </Button>
                  )}
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

      {/* Objektzuweisungs-Dialog (Reinigungskraft) */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Objekte zuweisen</DialogTitle>
            <DialogDescription>
              {editTarget?.name} (Reinigungskraft) sieht nur die hier zugewiesenen
              Objekte – mindestens eines ist Pflicht.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {objects.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                Noch keine Objekte vorhanden.
              </p>
            ) : (
              objects.map((obj) => (
                <label
                  key={obj.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/50"
                >
                  <Checkbox
                    checked={editObjectIds.includes(obj.id)}
                    onCheckedChange={() => toggleEditObject(obj.id)}
                    aria-label={`${obj.name} zuweisen`}
                  />
                  <span className="min-w-0 truncate">{obj.name}</span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={editSaving}
            >
              Abbrechen
            </Button>
            <Button onClick={() => void handleEditSave()} disabled={editSaving}>
              {editSaving ? <Loader2 className="animate-spin" /> : null}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Individueller Vertrag (custom) eines bestehenden Nutzers */}
      <Dialog open={editContract !== null} onOpenChange={(open) => { if (!open) setEditContract(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Individuellen Vertrag bearbeiten</DialogTitle>
            <DialogDescription>
              {editContract?.name} – Soll-Stunden, Arbeitstage und Jahresurlaub
              frei festlegen. Der Urlaubsanspruch wird beim Ändern der
              Arbeitstage automatisch vorgeschlagen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ec-weekly">Soll-Stunden / Woche</Label>
              <Input
                id="ec-weekly"
                type="number"
                min={0.5}
                step="0.5"
                max={168}
                value={editWeekly}
                onChange={(e) => setEditWeekly(e.target.value)}
                disabled={editContractSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-days">Arbeitstage / Woche</Label>
              <Input
                id="ec-days"
                type="number"
                min={1}
                step="0.5"
                max={7}
                value={editDays}
                onChange={(e) => handleDaysChange(e.target.value, setEditDays, setEditVacation)}
                disabled={editContractSaving}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec-vacation">Urlaubstage / Jahr</Label>
            <Input
              id="ec-vacation"
              type="number"
              min={0}
              max={365}
              value={editVacation}
              onChange={(e) => setEditVacation(e.target.value)}
              disabled={editContractSaving}
            />
            <p className="text-xs text-muted-foreground">
              Vorschlag: 30 Tage × Arbeitstage ÷ 5 – manuell überschreibbar.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditContract(null)}
              disabled={editContractSaving}
            >
              Abbrechen
            </Button>
            <Button onClick={() => void handleContractEditSave()} disabled={editContractSaving}>
              {editContractSaving ? <Loader2 className="animate-spin" /> : null}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
