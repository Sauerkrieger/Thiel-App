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
  Search,
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
import { USER_EMAIL_DOMAIN } from "@/lib/company";

type CurrentUser = {
  id: string;
  email: string | null;
  name: string;
  role: UserRole;
  username: string;
  phone?: string | null;
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
  driver: "Driver",
  facility_manager: "Cleaner",
  substitute: "Substitute",
};

export function SettingsPage({
  user,
  passkeys,
  users,
  objects,
  isAdmin,
  supportPhone,
}: {
  user: CurrentUser;
  passkeys: PasskeyInfo[];
  users: UserListItem[];
  objects: ObjectOption[];
  isAdmin: boolean;
  supportPhone: string | null;
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
      toast.error("This browser does not support passkeys.");
      return;
    }
    setPasskeyLoading(true);
    try {
      const optionsRes = await fetch("/api/auth/passkeys/register-options", {
        method: "POST",
      });
      const optionsData = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        toast.error(optionsData.error ?? "Could not start registration.");
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
        toast.error(verifyData.error ?? "Could not save the passkey.");
        return;
      }

      toast.success("Passkey saved!");
      // Vollreload, damit die neue Passkey-Liste frisch vom Server kommt
      // (useState wird durch router.refresh() nicht aktualisiert).
      window.location.reload();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        toast.error("Registration cancelled.");
      } else {
        toast.error("Passkey registration failed.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    const res = await fetch(`/api/auth/passkeys/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not delete the passkey.");
      return;
    }
    setPasskeysState((prev) => prev.filter((p) => p.id !== id));
    toast.success("Passkey entfernt.");
  }

  return (
    <div className="container py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          {/* div statt p: Badge rendert ein <div>, und <div> darf nicht in <p> stehen
              (sonst React-Hydration-Fehler „<div> cannot be a descendant of <p>“). */}
          <div className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.name}</span>{" "}
            · <Badge variant="secondary">{ROLE_LABELS[user.role] ?? user.role}</Badge>
          </div>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut /> Sign out
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
            <>
              <CompanySettingsSection supportPhone={supportPhone} />
              <UsersSection
              users={users}
              objects={objects}
              onChanged={() => router.refresh()}
            />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompanySettingsSection({ supportPhone }: { supportPhone: string | null }) {
  const [phone, setPhone] = useState(supportPhone ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (phone.trim() && !/^[0-9 +\-]+$/.test(phone.trim())) { toast.error("Invalid support number."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/chat/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support_phone_number: phone.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { toast.error(data.error ?? "Could not save the support number."); return; }
      setPhone(data.supportPhoneNumber ?? ""); toast.success("Supportnummer gespeichert.");
    } finally { setSaving(false); }
  }
  return <Card><CardHeader><CardTitle>Firmenkontakt</CardTitle><CardDescription>Central support number for direct calls from the employee chat.</CardDescription></CardHeader><CardContent className="space-y-3"><Label htmlFor="support-phone">Supportnummer</Label><Input id="support-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. +49 931 123456" disabled={saving} /><Button onClick={() => void save()} disabled={saving}>Save</Button></CardContent></Card>;
}

/* ------------------------------------------------------------------ */
/* Profil: Benutzernamen ändern                                        */
/* ------------------------------------------------------------------ */

function ProfileSection({ user }: { user: CurrentUser }) {
  const [username, setUsername] = useState(user.username);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!username.trim()) {
      toast.error("Please enter a username.");
      return;
    }
    if (phone.trim() && !/^[0-9 +\-]+$/.test(phone.trim())) {
      toast.error("Invalid phone number. Allowed are digits, spaces, + and -.");
      return;
    }
    setLoading(true);
    try {
      const res = await offlineFetch("/api/auth/me-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save the profile.");
        return;
      }
      toast.success("Profile saved.");
      window.location.reload();
    } catch {
      toast.error("Could not save the profile.");
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
          Username and display name for your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">Username (login)</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. Max"
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Wird in „{username || "…"}@{USER_EMAIL_DOMAIN}“ umgewandelt.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Anzeigename</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Max"
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Handy-/Telefonnummer</Label>
          <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +49 171 1234567" disabled={loading} />
          <p className="text-xs text-muted-foreground">Shown in the chat for direct calls.</p>
        </div>
        <Button onClick={handleSave} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Save
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
      toast.error("The new password must be at least 8 characters long.");
      return;
    }
    if (next !== confirm) {
      toast.error("The passwords do not match.");
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
        toast.error(data.error ?? "Could not change the password.");
        return;
      }
      toast.success("Password changed.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      toast.error("Could not change the password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Change password
        </CardTitle>
        <CardDescription>Set a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
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
            <Label htmlFor="new">New password</Label>
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
            <Label htmlFor="confirm">Repeat new password</Label>
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
            Change password
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
          Sign in conveniently with your fingerprint or Face ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No passkeys saved yet.
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
                    Added {new Date(pk.created_at).toLocaleDateString("en-GB")}
                    {pk.last_used_at
                      ? ` · Last used ${new Date(pk.last_used_at).toLocaleDateString("en-GB")}`
                      : " · Not used yet"}
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
          Add passkey
        </Button>
        <p className="text-xs text-muted-foreground">
          Your browser shows the system dialogs (fingerprint / Face ID).
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* User management (Admin)                                          */
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
  // Suchbegriff für die Benutzerliste (filtert nach Anzeigename/Benutzername).
  const [userQuery, setUserQuery] = useState("");

  // Lösch-Bestätigung für einen Benutzer (gestalteter Dialog)
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      toast.error("Username and password are required.");
      return;
    }
    if (password.length < 8) {
      toast.error("The password must be at least 8 characters long.");
      return;
    }
    // Reinigungskräfte müssen beim Anlegen mindestens einem Objekt zugeteilt werden.
    if (role === "facility_manager" && selectedObjectIds.length === 0) {
      toast.error("Please select at least one object for the cleaner.");
      return;
    }
    const weekly = Number(weeklyTargetHours);
    const days = Number(workingDaysPerWeek);
    const vacation = Number(vacationDaysPerYear);
    if (!Number.isFinite(weekly) || weekly <= 0 || weekly > 168) {
      toast.error("Please enter valid target hours per week (1–168).");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 7) {
      toast.error("Please enter valid working days per week (1–7).");
      return;
    }
    if (!Number.isInteger(vacation) || vacation < 0 || vacation > 365) {
      toast.error("Please enter valid vacation days per year (0–365).");
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
        toast.error(data.error ?? "Could not create the user.");
        return;
      }
      toast.success(`User "${data.user?.name ?? username}" created.`);
      setUsername("");
      setName("");
      setPassword("");
      setRole("driver");
      applyContractPreset("full_time");
      setSelectedObjectIds([]);
      onChanged();
    } catch {
      toast.error("Could not create the user.");
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
        toast.error(data.error ?? "Could not change the role.");
        return;
      }
      toast.success("Role changed.");
      onChanged();
    } catch {
      toast.error("Could not change the role.");
    } finally {
      setSavingId(null);
    }
  }

  /** Objektzuweisungen einer Reinigungskraft speichern (Rolle + Objekte). */
  async function handleEditSave() {
    if (!editTarget) return;
    if (editObjectIds.length === 0) {
      toast.error("Please select at least one object for the cleaner.");
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
        toast.error(data.error ?? "Could not save object assignment.");
        return;
      }
      toast.success("Object assignment saved.");
      setEditTarget(null);
      onChanged();
    } catch {
      toast.error("Could not save object assignment.");
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
        toast.error(data.error ?? "Could not change the contract type.");
        return;
      }
      toast.success("Contract type changed.");
      onChanged();
    } catch {
      toast.error("Could not change the contract type.");
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
      toast.error("Please enter valid target hours per week (1–168).");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 7) {
      toast.error("Please enter valid working days per week (1–7).");
      return;
    }
    if (!Number.isInteger(vacation) || vacation < 0 || vacation > 365) {
      toast.error("Please enter valid vacation days per year (0–365).");
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
        toast.error(data.error ?? "Could not save the contract.");
        return;
      }
      toast.success("Contract saved.");
      setEditContract(null);
      onChanged();
    } catch {
      toast.error("Could not save the contract.");
    } finally {
      setEditContractSaving(false);
    }
  }

  /** Filtert die Benutzerliste nach dem Suchbegriff (Name oder @Benutzername). */
  const query = userQuery.trim().toLowerCase();
  const visibleUsers = query
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(query) ||
          u.username.toLowerCase().includes(query),
      )
    : users;

  /** Löscht den im Dialog bestätigten Benutzer. */
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await offlineFetch(`/api/auth/users/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not delete the user.");
        return;
      }
      toast.success(`User “${deleteTarget.name}” deleted.`);
      setDeleteTarget(null);
      onChanged();
    } catch {
      toast.error("Could not delete the user.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" /> User management
        </CardTitle>
        <CardDescription>
          Create accounts for employees and drivers and assign roles.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleCreate} className="space-y-3 rounded-md border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4 text-primary" /> New user
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nu-username">Username</Label>
              <Input
                id="nu-username"
                placeholder="e.g. Max"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-name">Anzeigename</Label>
              <Input
                id="nu-name"
                placeholder="e.g. Max Mustermann"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nu-password">Password</Label>
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
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="facility_manager">Cleaner</SelectItem>
                  <SelectItem value="substitute">Substitute</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Contract type</Label>
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
                  <SelectItem value="mini_job">Mini job</SelectItem>
                  <SelectItem value="custom">Individuell</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-days">Working days / week</Label>
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
                Vacation allowance is suggested automatically.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {contractType === "custom" && (
              <div className="space-y-1.5">
                <Label htmlFor="nu-weekly">Target hours / week</Label>
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
            )}
            <div className={contractType === "custom" ? "space-y-1.5" : "space-y-1.5 sm:col-span-2"}>
              <Label htmlFor="nu-vacation">Vacation days / year</Label>
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
                Annual vacation – adjustable manually for every contract type.
              </p>
            </div>
          </div>

          {/* Reinigungskraft: Objektzuweisung (mindestens 1) beim Anlegen */}
          {role === "facility_manager" && (
            <div className="space-y-1.5">
              <Label>
                Assigned objects <span className="text-destructive">*</span>
              </Label>
              {objects.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No objects yet – create objects first.
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
                          aria-label={`Assign ${obj.name}`}
                        />
                        <span className="min-w-0 truncate">{obj.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedObjectIds.length} selected – the cleaner only sees these objects.
                  </p>
                </>
              )}
            </div>
          )}

          <Button type="submit" disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : null}
            Create user
          </Button>
        </form>

        {users.length > 0 && (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              className="pl-9"
              placeholder="Search names…"
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              aria-label="Search users by name"
            />
          </div>
        )}
        {visibleUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {users.length === 0 ? "No users yet." : "No users found."}
          </p>
        ) : (
          <div className="space-y-2">
            {visibleUsers.map((u) => (
              <div key={u.id} className="space-y-1.5 rounded-md border p-3">
                {/* Name + Rollen-Badge (immer voll sichtbar) */}
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{u.name}</span>
                  <Badge variant="secondary" className="shrink-0 whitespace-nowrap">
                    {ROLE_LABELS[u.role] ?? u.role}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  @{u.username} · Seit{" "}
                  {new Date(u.created_at).toLocaleDateString("en-GB")}
                </p>
                {/* Bedienelemente – für alle Rollen identisch aufgebaut */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select
                    value={u.role}
                    onValueChange={(v) => handleRoleSelect(u.id, v)}
                    disabled={savingId === u.id}
                  >
                    {/* w-36, damit „Reinigungskraft“ im Trigger nicht abgeschnitten wird */}
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Driver</SelectItem>
                      <SelectItem value="facility_manager">Cleaner</SelectItem>
                      <SelectItem value="substitute">Substitute</SelectItem>
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
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => {
                        setEditTarget(u);
                        setEditObjectIds(u.object_ids ?? []);
                      }}
                      title={`${(u.object_ids ?? []).length} objects assigned`}
                      aria-label={`${(u.object_ids ?? []).length} objects assigned`}
                    >
                      <ListChecks className="h-3.5 w-3.5 shrink-0" />
                      <span className="tabular-nums">{(u.object_ids ?? []).length}</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(u)}
                    aria-label={`Delete ${u.name}`}
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
            <DialogTitle>Assign objects</DialogTitle>
            <DialogDescription>
              {editTarget?.name} (cleaner) only sees the objects assigned here – at least one is required.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {objects.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                No objects yet.
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
                    aria-label={`Assign ${obj.name}`}
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
              Cancel
            </Button>
            <Button onClick={() => void handleEditSave()} disabled={editSaving}>
              {editSaving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Individueller Vertrag (custom) eines bestehenden Nutzers */}
      <Dialog open={editContract !== null} onOpenChange={(open) => { if (!open) setEditContract(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit individual contract</DialogTitle>
            <DialogDescription>
              {editContract?.name} – target hours, working days and annual leave
              set freely. The vacation entitlement is recalculated when the
              Arbeitstage automatisch vorgeschlagen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ec-weekly">Target hours / week</Label>
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
              <Label htmlFor="ec-days">Working days / week</Label>
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
            <Label htmlFor="ec-vacation">Vacation days / year</Label>
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
              Suggestion: 30 days × working days ÷ 5 – can be overridden manually.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditContract(null)}
              disabled={editContractSaving}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleContractEditSave()} disabled={editContractSaving}>
              {editContractSaving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lösch-Bestätigung (gestalteter Dialog statt window.confirm) */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-destructive" /> Delete user?</DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}“ (@{deleteTarget?.username}) will be deleted permanently. The account cannot be restored afterwards.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
