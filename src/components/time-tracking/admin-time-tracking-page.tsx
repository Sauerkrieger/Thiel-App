"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronRight, Clock3, Download, History, LoaderCircle, Pencil, Plus, Search, ShieldCheck, Timer, Trash2, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTRACT_LABELS, dailyTargetMinutes, overtimeBalanceHours } from "@/lib/contract";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
import { hoursToLabel, minutesToLabel, requiredBreakMinutes, workedMinutesOf } from "@/lib/time-format";
import type { ContractType } from "@/types/database";
import type { TimeEntry, TimeEntryAuditLog, TimeOffRequest } from "@/types/time-tracking";

type Employee = { id: string; name: string; role: string; contract_type: ContractType | null; vacation_days_total: number; vacation_days_used: number; overtime_hours: number; weekly_target_hours: number | null; working_days_per_week: number | null; vacation_days_per_year: number | null; current_entry: TimeEntry | null; current_assignment?: { tour_id: string; tour_date: string; object_name: string | null } | null };
type OverviewEntry = TimeEntry & { profiles?: { name?: string; role?: string } | null; audit_logs?: TimeEntryAuditLog[] };
type Overview = { employees: Employee[]; entries: OverviewEntry[]; requests: (TimeOffRequest & { profiles?: { name?: string; role?: string } | null })[] };

const ROLE_LABELS: Record<string, string> = { admin: "Admin", driver: "Fahrer", facility_manager: "Reinigungskraft", substitute: "Springer" };
const REQUEST_TYPE: Record<string, string> = { vacation: "Urlaub", sick_leave: "Krankheit", unpaid: "Unbezahlt", compensatory: "Freizeitausgleich" };

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/** Wert für ein <input type="datetime-local"> (lokale Zeit). */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Status-Badge eines Stempel-Eintrags:
 * - Nicht freigegeben (nachgereicht ODER prüfbedürftig) → „Ausstehend“
 * - Nachgereichte Arbeitszeit, freigegeben → „Freigegeben“
 * - Normale Stempelung (Stempeluhr) → „Gestempelt“
 */
function entryBadge(entry: TimeEntry): { label: string; variant: "secondary" | "success" | "warning" } {
  if (!entry.is_approved) {
    return { label: "Ausstehend", variant: "warning" };
  }
  if (entry.source === "submitted") {
    return { label: "Freigegeben", variant: "success" };
  }
  return { label: "Gestempelt", variant: "secondary" };
}

/** Live-Dauer einer offenen Stempelung (seit Einstempeln, abzüglich Pause). */
function liveDurationLabel(entry: TimeEntry, nowMs: number): string {
  const start = Date.parse(entry.clock_in);
  if (Number.isNaN(start)) return "–";
  const breakMinutes = Number(entry.break_duration_minutes ?? 0);
  return minutesToLabel(
    Math.max(0, (nowMs - start) / 60000 - (Number.isFinite(breakMinutes) ? breakMinutes : 0)),
  );
}

/** Datum/Uhrzeit eines Audit-Eintrags, z. B. „08.08.2026 um 14:32 Uhr“. */
function formatAuditDate(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })} um ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  clock_in: "Start",
  clock_out: "Ende",
  break_duration_minutes: "Pause",
  is_approved: "Freigabe",
  requires_review: "Prüfbedarf",
  note: "Notiz",
};

function auditValueLabel(key: string, value: unknown): string {
  if (value === null || value === undefined) return "–";
  if (key === "clock_in" || key === "clock_out") return formatAuditDate(String(value));
  if (key === "is_approved" || key === "requires_review") return value ? "Ja" : "Nein";
  if (key === "break_duration_minutes") return `${value} Min.`;
  return String(value);
}

/** Kleines Historiensymbol für bearbeitete Einträge (Tooltip mit letzter Änderung). */
function AuditHistoryButton({ entry, onOpen }: { entry: { audit_logs?: TimeEntryAuditLog[] | null }; onOpen: () => void }) {
  const logs = entry.audit_logs;
  if (!logs || logs.length === 0) return null;
  const last = logs[0];
  // z. B. „Vergessene Ausstempelung nachgereicht von Max am 08.08.2026 um 14:32 Uhr“
  const title = `${last.change_reason ?? "Geändert"} von ${last.changed_by_name ?? "unbekannt"} am ${formatAuditDate(last.changed_at)}`;
  return (
    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" title={title} onClick={onOpen} aria-label="Änderungshistorie anzeigen">
      <History className="h-3.5 w-3.5" />
    </Button>
  );
}

/** Status-Badge der Mitarbeiterkarte: Prüfbedarf bei markierter offener Stempelung. */
function employeeStatusBadge(entry: TimeEntry | null) {
  if (entry?.requires_review) {
    return <Badge variant="warning">Prüfbedarf</Badge>;
  }
  if (entry) {
    return <Badge variant="success">Aktiv</Badge>;
  }
  return <Badge variant="secondary">Nicht aktiv</Badge>;
}

export function AdminTimeTrackingPage() {
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  // Debounce: Die Freitext-Suche soll nicht bei jedem Tastendruck einen
  // kompletten Server-Request + Cache-Read auslösen, sondern erst, wenn der
  // Nutzer kurz pausiert (gleiche Filterung, nur sparsamer).
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Monatsübersicht
  const [month, setMonth] = useState(currentMonth());
  // Mitarbeiter-Dialog (Stempelhistorie + Konto anpassen)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [editVacation, setEditVacation] = useState("");
  const [editOvertime, setEditOvertime] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  // „Ausstempeln & Freigeben“-Dialog für offene Stempelungen (vergessene Ausstempelung)
  const [closingEntry, setClosingEntry] = useState<TimeEntry | null>(null);
  const [closeEnd, setCloseEnd] = useState("");
  const [closeBreak, setCloseBreak] = useState("0");
  const [closeNote, setCloseNote] = useState("");
  const [closeReason, setCloseReason] = useState("");

  // Änderungshistorie (Audit-Log) eines Eintrags
  const [auditEntry, setAuditEntry] = useState<OverviewEntry | null>(null);

  // Lösch-Bestätigung für einen Stempel-Eintrag (gestalteter Dialog)
  const [deleteTarget, setDeleteTarget] = useState<OverviewEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bearbeiten / Nacherfassen eines Stempel-Eintrags (Admin): entry = null
  // bedeutet „Eintrag nacherfassen“ (anlegen), sonst bestehenden Eintrag
  // bearbeiten. Start-/Endzeit, Pause und Begründung (Audit-Log, Pflicht).
  const [formTarget, setFormTarget] = useState<{ employee: Employee; entry: OverviewEntry | null } | null>(null);
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formBreak, setFormBreak] = useState("0");
  const [formReason, setFormReason] = useState("");
  const [savingEntryForm, setSavingEntryForm] = useState(false);

  // Live-Ticker für die Dauer-Anzeige im Prüfbedarf-Abschnitt
  const [now, setNow] = useState(() => Date.now());

  // Stale-while-revalidate: gecachte Übersicht sofort anzeigen, frische
  // Daten parallel vom Server nachladen (fresh = nach einer Mutation erzwungen).
  const load = useCallback(async (fresh = false) => {
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    const url = `/api/admin/time-tracking/overview?${params.toString()}`;
    const cached = fresh ? null : await offlineReadCached(url);
    if (cached) {
      setOverview(cached as Overview);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await offlineFetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Übersicht konnte nicht geladen werden.");
      setOverview(body as Overview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Übersicht konnte nicht geladen werden.");
    } finally { setLoading(false); }
  }, [role, debouncedQuery]);

  useEffect(() => { void load(); }, [load]);

  // Debounce der Freitext-Suche (siehe oben): sobald der Nutzer kurz pausiert.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function approveEntry(entry: TimeEntry, approved: boolean) {
    setSaving(entry.id);
    try {
      const res = await offlineFetch(`/api/admin/time-tracking/entries/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_approved: approved }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Arbeitszeit konnte nicht aktualisiert werden.");
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Arbeitszeit konnte nicht aktualisiert werden."); } finally { setSaving(null); }
  }

  /** Löscht den im Dialog bestätigten Stempel-Eintrag. */
  async function deleteEntry() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await offlineFetch(`/api/admin/time-tracking/entries/${deleteTarget.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Eintrag konnte nicht gelöscht werden.");
      toast.success("Eintrag gelöscht.");
      setDeleteTarget(null);
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Eintrag konnte nicht gelöscht werden."); } finally { setDeleting(false); }
  }

  /**
   * Soll-Tagesdauer (Minuten, netto) des Mitarbeiters einer Stempelung –
   * Basis für den Endzeit-Vorschlag im Ausstempeln-Dialog. null, wenn der
   * Mitarbeiter nicht in der Übersicht ist (Filter) oder kein Wert
   * berechenbar ist (fällt auf „jetzt“ zurück).
   */
  function dailyMinutesOf(entry: TimeEntry): number | null {
    const employee = overview?.employees.find((e) => e.id === entry.user_id);
    return employee ? dailyTargetMinutes(employee) : null;
  }

  /**
   * Öffnet den „Ausstempeln & Freigeben“-Dialog für eine offene Stempelung.
   *
   * Endzeit-Vorschlag: Die vertragliche Soll-Tagesdauer des Mitarbeiters
   * (Wochen-Soll ÷ Arbeitstage, z. B. Minijob 10 h/2 Tage = 5 h/Tag) wird
   * auf die Einstempelzeit aufgeschlagen (inkl. gesetzlicher Mindestpause
   * nach § 4 ArbZG). Beispiel: 08:00 eingestempelt + 5 h → Vorschlag 13:00.
   * Als Grund der Änderung wird „Ausstempeln vergessen“ vorbelegt.
   */
  function openCloseEntry(entry: TimeEntry) {
    setClosingEntry(entry);
    const dailyMinutes = dailyMinutesOf(entry);
    const clockInMs = Date.parse(entry.clock_in);
    if (dailyMinutes !== null && !Number.isNaN(clockInMs)) {
      // Anwesenheit = Netto-Soll + gesetzliche Mindestpause (§ 4 ArbZG).
      // Iterativ, damit auch Soll-Zeiten ≥ 9 h exakt die 45-Minuten-Pause
      // einrechnen (die Pause selbst erhöht die Anwesenheit).
      let presence = dailyMinutes;
      let breakMinutes = 0;
      for (let i = 0; i < 3; i++) {
        const next = requiredBreakMinutes(
          entry.clock_in,
          new Date(clockInMs + presence * 60_000).toISOString(),
        );
        if (next === breakMinutes) break;
        breakMinutes = next;
        presence = dailyMinutes + breakMinutes;
      }
      setCloseEnd(
        toLocalInputValue(new Date(clockInMs + presence * 60_000)),
      );
      setCloseBreak(
        String(
          Math.max(Number(entry.break_duration_minutes ?? 0), breakMinutes),
        ),
      );
    } else {
      setCloseEnd(toLocalInputValue(new Date()));
      setCloseBreak(String(entry.break_duration_minutes ?? 0));
    }
    setCloseNote(entry.note ?? "");
    // Standard-Begründung fürs Audit-Log direkt vorbelegen (editierbar).
    setCloseReason("Ausstempeln vergessen");
  }

  /** Schließt eine offene Stempelung aktiv: Endzeit setzen, optional direkt freigeben. */
  async function closeEntry(approved: boolean) {
    if (!closingEntry) return;
    const endMs = new Date(closeEnd).getTime();
    if (!closeEnd || Number.isNaN(endMs)) {
      toast.error("Bitte eine gültige Endzeit angeben.");
      return;
    }
    if (endMs <= Date.parse(closingEntry.clock_in)) {
      toast.error("Die Endzeit muss nach der Einstempelzeit liegen.");
      return;
    }
    const breakMinutes = Number(closeBreak);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 24 * 60) {
      toast.error("Bitte eine gültige Pausenzeit in Minuten angeben (0–1440).");
      return;
    }
    setSaving(closingEntry.id);
    try {
      const res = await offlineFetch(`/api/admin/time-tracking/entries/${closingEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_approved: approved,
          clock_out: new Date(endMs).toISOString(),
          break_duration_minutes: breakMinutes,
          note: closeNote.trim() || null,
          change_reason: closeReason.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Eintrag konnte nicht aktualisiert werden.");
      toast.success(approved ? "Eintrag ausgestempelt und freigegeben." : "Eintrag ausgestempelt (wartet auf Freigabe).");
      setClosingEntry(null);
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Eintrag konnte nicht aktualisiert werden."); } finally { setSaving(null); }
  }

  /** Öffnet „Eintrag nacherfassen“: leeres Formular für den Mitarbeiter. */
  function openCreateEntry(employee: Employee) {
    setFormTarget({ employee, entry: null });
    setFormStart(toLocalInputValue(new Date()));
    // Endzeit leer lassen – der Admin trägt die tatsächliche Zeit ein
    // (Vorschlag „jetzt“ wäre irreführend, da Ende > Start gelten muss).
    setFormEnd("");
    setFormBreak("0");
    setFormReason("");
  }

  /** Öffnet „Stempelung bearbeiten“ mit den aktuellen Werten des Eintrags. */
  function openEditEntry(entry: OverviewEntry) {
    const employee = overview?.employees.find((e) => e.id === entry.user_id);
    if (!employee) return;
    setFormTarget({ employee, entry });
    setFormStart(toLocalInputValue(new Date(entry.clock_in)));
    setFormEnd(entry.clock_out ? toLocalInputValue(new Date(entry.clock_out)) : "");
    setFormBreak(String(entry.break_duration_minutes ?? 0));
    setFormReason("");
  }

  /**
   * Speichert den Bearbeiten-/Nacherfassen-Dialog.
   * - Bestehender Eintrag → PATCH (Start, Ende, Pause, Begründung)
   * - Neuer Eintrag → POST /api/admin/time-tracking/entries (mit user_id)
   * Das Audit-Log schreibt zwingend der Server (Begründung wird mitgegeben).
   */
  async function saveEntryForm() {
    if (!formTarget) return;
    const startMs = new Date(formStart).getTime();
    if (!formStart || Number.isNaN(startMs)) {
      toast.error("Bitte eine gültige Startzeit angeben.");
      return;
    }
    const endMs = new Date(formEnd).getTime();
    const hasEnd = Boolean(formEnd) && !Number.isNaN(endMs);
    if (formTarget.entry === null && !hasEnd) {
      toast.error("Bitte eine Endzeit angeben.");
      return;
    }
    if (hasEnd && endMs <= startMs) {
      toast.error("Die Endzeit muss nach der Startzeit liegen.");
      return;
    }
    const breakMinutes = Number(formBreak);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 24 * 60) {
      toast.error("Bitte eine gültige Pausenzeit in Minuten angeben (0–1440).");
      return;
    }
    if (!formReason.trim()) {
      toast.error("Bitte eine Begründung für das Audit-Log angeben.");
      return;
    }
    setSavingEntryForm(true);
    try {
      const payload: Record<string, unknown> = {
        clock_in: new Date(startMs).toISOString(),
        break_duration_minutes: breakMinutes,
        change_reason: formReason.trim(),
      };
      if (hasEnd) payload.clock_out = new Date(endMs).toISOString();
      const url = formTarget.entry
        ? `/api/admin/time-tracking/entries/${formTarget.entry.id}`
        : "/api/admin/time-tracking/entries";
      const method = formTarget.entry ? "PATCH" : "POST";
      if (!formTarget.entry) payload.user_id = formTarget.employee.id;
      const res = await offlineFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Eintrag konnte nicht gespeichert werden.");
      toast.success(formTarget.entry ? "Eintrag aktualisiert." : "Eintrag nacherfasst.");
      setFormTarget(null);
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setSavingEntryForm(false);
    }
  }

  async function reviewRequest(request: TimeOffRequest, status: "approved" | "rejected") {
    setSaving(request.id);
    try {
      const res = await offlineFetch(`/api/time-tracking/requests/${request.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Antrag konnte nicht aktualisiert werden.");
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Antrag konnte nicht aktualisiert werden."); } finally { setSaving(null); }
  }

  async function downloadCsv() {
    try {
      const res = await fetch("/api/admin/time-tracking/export");
      if (!res.ok) throw new Error("CSV-Export fehlgeschlagen.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `zeiterfassung-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "CSV-Export fehlgeschlagen."); }
  }

  function openEmployee(employee: Employee) {
    setSelectedEmployee(employee);
    // Resturlaub = Jahresurlaubsanspruch (Vertrag) minus genutzte Tage.
    const entitlement =
      employee.vacation_days_per_year ?? employee.vacation_days_total ?? 0;
    setEditVacation(String(Math.max(0, entitlement - (employee.vacation_days_used ?? 0))));
    setEditOvertime(String(Number(employee.overtime_hours ?? 0)));
  }

  async function saveAccount() {
    if (!selectedEmployee) return;
    const remaining = Number(editVacation.replace(",", "."));
    const overtime = Number(editOvertime.replace(",", "."));
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > 365) {
      toast.error("Bitte einen gültigen Resturlaub (0–365 Tage) angeben.");
      return;
    }
    if (!Number.isFinite(overtime) || overtime < -1000 || overtime > 1000) {
      toast.error("Bitte einen gültigen Überstundenwert angeben.");
      return;
    }
    setSavingAccount(true);
    try {
      const res = await offlineFetch(`/api/auth/users/${selectedEmployee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Der Jahresanspruch ergibt sich aus genutzten Tagen + neuem Resturlaub.
          vacation_days_per_year: (selectedEmployee.vacation_days_used ?? 0) + remaining,
          overtime_hours: overtime,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Konto konnte nicht aktualisiert werden.");
      toast.success("Konto aktualisiert.");
      setSelectedEmployee(null);
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Konto konnte nicht aktualisiert werden."); } finally { setSavingAccount(false); }
  }

  const openCount = overview?.employees.filter((employee) => employee.current_entry).length ?? 0;
  const pendingRequests = overview?.requests.filter((request) => request.status === "pending") ?? [];
  // Prüfbedarf: noch OFFENE, automatisch markierte Stempelungen (vergessene Ausstempelung).
  const reviewEntries = overview?.entries.filter((entry) => entry.requires_review && !entry.clock_out) ?? [];
  // Freigabe-Feed: abgeschlossene, aber noch nicht freigegebene Stempelungen
  // (nachgereichte Arbeitszeit ODER markiert & vom Mitarbeiter/Admin geschlossen).
  // Alle abgeschlossenen, aber noch nicht freigegebenen Stempelungen
  // (unabhängig von source/requires_review – auch manuell vom Admin
  // ausgestempelte Clock-Einträge müssen im Freigabe-Feed erscheinen).
  const pendingEntries = overview?.entries.filter((entry) => !entry.is_approved && entry.clock_out !== null) ?? [];

  // Live-Dauer im Prüfbedarf-Abschnitt aktualisieren (alle 30 s).
  useEffect(() => {
    if (reviewEntries.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [reviewEntries.length]);

  // Gesetzliche Mindestpause (§ 4 ArbZG) für die gewählte Endzeit im Ausstempeln-Dialog.
  const closeRequiredBreak = closingEntry
    ? (() => {
        const ms = new Date(closeEnd).getTime();
        return Number.isNaN(ms)
          ? 0
          : requiredBreakMinutes(closingEntry.clock_in, new Date(ms).toISOString());
      })()
    : 0;
  const closeEnteredBreak = Number(closeBreak) || 0;

  // Gesetzliche Mindestpause (§ 4 ArbZG) für den Bearbeiten-/Nacherfassen-Dialog.
  const formRequiredBreak =
    formTarget && formStart && formEnd
      ? (() => {
          const startMs = new Date(formStart).getTime();
          const endMs = new Date(formEnd).getTime();
          return Number.isNaN(startMs) || Number.isNaN(endMs)
            ? 0
            : requiredBreakMinutes(
                new Date(startMs).toISOString(),
                new Date(endMs).toISOString(),
              );
        })()
      : 0;

  /** Überstunden eines Mitarbeiters: automatisch (Stempelungen & Soll) + Korrektur. */
  function overtimeOf(employee: Employee): { auto: number; correction: number; total: number } {
    if (!overview) return { auto: 0, correction: 0, total: 0 };
    const entries = overview.entries.filter((entry) => entry.user_id === employee.id);
    const auto = overtimeBalanceHours(
      entries,
      employee.contract_type,
      employee.weekly_target_hours ?? null,
    );
    const correction = Number(employee.overtime_hours ?? 0);
    return { auto, correction, total: auto + correction };
  }

  /**
   * Vertrags-Label inkl. Details (z. B. „Vollzeit · 5 Tage/Woche“ oder
   * „Individuell · 35 h/Woche · 4 Tage/Woche“).
   */
  function contractLabel(employee: Employee): string {
    const label = CONTRACT_LABELS[employee.contract_type ?? "full_time"] ?? "Vollzeit";
    const days =
      typeof employee.working_days_per_week === "number"
        ? employee.working_days_per_week
        : null;
    const parts = [label];
    if (
      employee.contract_type === "custom" &&
      typeof employee.weekly_target_hours === "number"
    ) {
      parts.push(`${employee.weekly_target_hours} h/Woche`);
    }
    if (days !== null) parts.push(`${days} Tage/Woche`);
    return parts.join(" · ");
  }

  /** Vertrags-Detailzeile für den Konto-Dialog (Soll, Arbeitstage, Urlaub). */
  function contractDetailsLine(employee: Employee): string {
    const weekly =
      typeof employee.weekly_target_hours === "number"
        ? `${employee.weekly_target_hours} h`
        : "–";
    const days =
      typeof employee.working_days_per_week === "number"
        ? `${employee.working_days_per_week} Tage`
        : "–";
    const vacation =
      employee.vacation_days_per_year ?? employee.vacation_days_total ?? 0;
    return `Soll ${weekly}/Woche · ${days}/Woche · Urlaub ${vacation} Tage/Jahr`;
  }

  /** Resturlaub eines Mitarbeiters (Jahresanspruch minus genutzte Tage). */
  function vacationRemainingOf(employee: Employee): number {
    const entitlement =
      employee.vacation_days_per_year ?? employee.vacation_days_total ?? 0;
    return Math.max(0, entitlement - (employee.vacation_days_used ?? 0));
  }

  // Monatsübersicht: freigegebene, abgeschlossene Einträge pro Mitarbeiter.
  const monthRows = useMemo(() => {
    if (!overview) return [];
    return overview.employees.map((employee) => {
      let total = 0;
      const days = new Set<string>();
      for (const entry of overview.entries) {
        if (entry.user_id !== employee.id || entry.is_approved === false || !entry.clock_out) continue;
        const start = new Date(entry.clock_in);
        const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
        if (key !== month) continue;
        total += workedMinutesOf(entry);
        days.add(start.toLocaleDateString("de-DE"));
      }
      return { employee, total, days: days.size };
    });
  }, [overview, month]);
  const monthTotal = monthRows.reduce((sum, row) => sum + row.total, 0);

  const employeeEntries = useMemo(() => {
    if (!overview || !selectedEmployee) return [];
    return overview.entries.filter((entry) => entry.user_id === selectedEmployee.id).slice(0, 25);
  }, [overview, selectedEmployee]);

  return (
    <div className="container py-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-sm font-medium text-primary">Verwaltung</p><h1 className="text-3xl font-bold tracking-tight">Zeitadmin</h1><p className="mt-1 text-sm text-muted-foreground">Mitarbeiterstatus, Freigaben, Konten und Monatsübersicht.</p></div><Button variant="outline" onClick={() => void downloadCsv()}><Download /> Lohn-CSV exportieren</Button></div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3"><Stat icon={<Users />} label="Mitarbeiter" value={String(overview?.employees.length ?? 0)} /><Stat icon={<UserCheck />} label="Gerade aktiv" value={String(openCount)} /><Stat icon={<ShieldCheck />} label="Offene Freigaben" value={String(pendingRequests.length + pendingEntries.length + reviewEntries.length)} /></div>
      <Card className="mt-6"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mitarbeiter suchen…" /></div><Select value={role} onValueChange={setRole}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Rollen</SelectItem>{Object.entries(ROLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></CardContent></Card>

      {loading && !overview ? <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Übersicht wird geladen…</div> : overview ? <>
        <Card className="mt-6"><CardHeader><CardTitle>Mitarbeiterstatus</CardTitle><CardDescription>Wer ist aktuell eingestempelt? Klicke auf eine Karte für Stempelhistorie und Kontokorrektur.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{overview.employees.map((employee) => <button key={employee.id} type="button" onClick={() => openEmployee(employee)} className="group w-full rounded-xl border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{employee.name}</p><p className="text-xs text-muted-foreground">{ROLE_LABELS[employee.role] ?? employee.role}</p></div><div className="flex items-center gap-1.5">{employeeStatusBadge(employee.current_entry)}<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div></div><p className="mt-4 text-sm text-muted-foreground">{employee.current_entry ? `Seit ${timeLabel(employee.current_entry.clock_in)} Uhr` : `Resturlaub ${vacationRemainingOf(employee)} Tage`}</p>{employee.current_assignment && <p className="mt-1 text-xs text-primary">Tour {employee.current_assignment.tour_id.slice(0, 8)} · nächstes Objekt: {employee.current_assignment.object_name ?? "unbekannt"}</p>}<p className="mt-1 text-xs text-muted-foreground">Überstunden: {hoursToLabel(overtimeOf(employee).total)} · {contractLabel(employee)}</p></button>)}</div></CardContent></Card>

        <Card className="mt-6"><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-3"><span>Monatsübersicht</span><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 w-44" aria-label="Monat wählen" /></CardTitle><CardDescription>Gesamtarbeitszeit aller Mitarbeiter im gewählten Monat (freigegebene, abgeschlossene Einträge).</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Mitarbeiter</TableHead><TableHead>Rolle</TableHead><TableHead className="text-right">Tage</TableHead><TableHead className="text-right">Arbeitszeit</TableHead></TableRow></TableHeader><TableBody>{monthRows.map((row) => <TableRow key={row.employee.id}><TableCell className="font-medium">{row.employee.name}</TableCell><TableCell className="text-muted-foreground">{ROLE_LABELS[row.employee.role] ?? row.employee.role}</TableCell><TableCell className="text-right">{row.days}</TableCell><TableCell className="text-right font-mono">{minutesToLabel(row.total)}</TableCell></TableRow>)}</TableBody><TableFooter><TableRow><TableCell colSpan={3}>Gesamt ({monthRows.length} Mitarbeiter)</TableCell><TableCell className="text-right font-mono">{minutesToLabel(monthTotal)}</TableCell></TableRow></TableFooter></Table></CardContent></Card>

        <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Prüfbedarf</CardTitle><CardDescription>Vergessene Ausstempelungen – offene Stempelungen, die automatisch markiert wurden (12 h überschritten oder Mitternacht erreicht). Die Dauer zählt live mit.</CardDescription></CardHeader><CardContent className="space-y-3">{reviewEntries.length === 0 ? <p className="text-sm text-muted-foreground">Keine offenen Prüfbedarf-Einträge.</p> : reviewEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" />{entry.profiles?.name ?? entry.user_id}<Badge variant="warning">Prüfbedarf</Badge></div><p className="text-xs text-muted-foreground">Eingestempelt am {new Date(entry.clock_in).toLocaleDateString("de-DE")} um {timeLabel(entry.clock_in)} Uhr · läuft seit {liveDurationLabel(entry, now)}</p>{entry.note && <p className="mt-1 text-xs text-muted-foreground">Notiz: {entry.note}</p>}</div><div className="flex gap-2"><AuditHistoryButton entry={entry} onOpen={() => setAuditEntry(entry)} /><Button size="sm" onClick={() => openCloseEntry(entry)} disabled={saving === entry.id}><Timer /> Ausstempeln &amp; Freigeben</Button><Button size="sm" variant="outline" onClick={() => setDeleteTarget(entry)} disabled={saving === entry.id}><Trash2 /> Löschen</Button></div></div>)}</CardContent></Card>

        <Card className="mt-6"><CardHeader><CardTitle>Freigabe-Feed</CardTitle><CardDescription>Nachgereichte Arbeitszeiten und Anträge prüfen.</CardDescription></CardHeader><CardContent className="space-y-3">{pendingEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />{entry.source === "submitted" ? `Nachgereichte Arbeitszeit · ${entry.profiles?.name ?? entry.user_id}` : `Vergessene Ausstempelung · ${entry.profiles?.name ?? entry.user_id}`}<Badge variant="warning">Ausstehend</Badge></div><p className="text-xs text-muted-foreground">{new Date(entry.clock_in).toLocaleDateString("de-DE")} · {timeLabel(entry.clock_in)} – {entry.clock_out ? timeLabel(entry.clock_out) : "offen"}{entry.break_duration_minutes > 0 ? ` · Pause ${entry.break_duration_minutes} Min.` : ""}{entry.clock_out ? ` · ${minutesToLabel(workedMinutesOf(entry))}` : ""}</p>{entry.note && <p className="mt-1 text-xs text-muted-foreground">Notiz: {entry.note}</p>}</div><div className="flex gap-2"><AuditHistoryButton entry={entry} onOpen={() => setAuditEntry(entry)} /><Button size="sm" onClick={() => void approveEntry(entry, true)} disabled={saving === entry.id}><Check /> Freigeben</Button><Button size="sm" variant="outline" onClick={() => setDeleteTarget(entry)} disabled={saving === entry.id}><Trash2 /> Löschen</Button></div></div>)}
      {pendingRequests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{REQUEST_TYPE[request.type] ?? request.type} · {request.profiles?.name ?? request.user_id}<Badge variant="warning">Ausstehend</Badge></div><p className="text-xs text-muted-foreground">{new Date(`${request.start_date}T00:00:00`).toLocaleDateString("de-DE")} – {new Date(`${request.end_date}T00:00:00`).toLocaleDateString("de-DE")}</p>{request.employee_note && <p className="mt-1 text-xs text-muted-foreground">Notiz: {request.employee_note}</p>}</div><div className="flex gap-2"><Button size="sm" onClick={() => void reviewRequest(request, "approved")} disabled={saving === request.id}>Genehmigen</Button><Button size="sm" variant="outline" onClick={() => void reviewRequest(request, "rejected")} disabled={saving === request.id}>Ablehnen</Button></div></div>)}{pendingEntries.length === 0 && pendingRequests.length === 0 && <p className="text-sm text-muted-foreground">Keine offenen Freigaben.</p>}</CardContent></Card>

        <Dialog open={selectedEmployee !== null} onOpenChange={(open) => { if (!open) setSelectedEmployee(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedEmployee?.name}</DialogTitle>
              <DialogDescription>{selectedEmployee ? `${ROLE_LABELS[selectedEmployee.role] ?? selectedEmployee.role} · ${contractLabel(selectedEmployee)} · Resturlaub ${vacationRemainingOf(selectedEmployee)} Tage · Überstunden ${hoursToLabel(overtimeOf(selectedEmployee).total)}` : ""}</DialogDescription>
            </DialogHeader>
            {selectedEmployee && <div className="space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">Stempelhistorie</h4>
                  <Button size="sm" variant="outline" onClick={() => openCreateEntry(selectedEmployee)} disabled={saving !== null}><Plus className="h-3.5 w-3.5" /> Eintrag nacherfassen</Button>
                </div>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {employeeEntries.length === 0 ? <p className="text-sm text-muted-foreground">Keine Stempelungen vorhanden.</p> : employeeEntries.map((entry) => { const badge = entryBadge(entry); return <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"><div><p className="font-medium">{new Date(entry.clock_in).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</p><p className="text-xs text-muted-foreground">{timeLabel(entry.clock_in)} – {entry.clock_out ? timeLabel(entry.clock_out) : "läuft gerade"}{entry.break_duration_minutes > 0 ? ` · Pause ${entry.break_duration_minutes} Min.` : ""}</p></div><div className="flex flex-wrap items-center justify-end gap-1.5"><span className="mr-1 font-mono text-xs">{entry.clock_out ? minutesToLabel(workedMinutesOf(entry)) : "offen"}</span>{!entry.clock_out && <Button size="sm" variant="outline" onClick={() => openCloseEntry(entry)} disabled={saving === entry.id}><Timer /> Ausstempeln &amp; Freigeben</Button>}<Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditEntry(entry)} disabled={saving === entry.id} title="Eintrag bearbeiten" aria-label="Eintrag bearbeiten"><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDeleteTarget(entry)} disabled={saving === entry.id} title="Eintrag löschen" aria-label="Eintrag löschen"><Trash2 className="h-3.5 w-3.5" /></Button><AuditHistoryButton entry={entry} onOpen={() => setAuditEntry(entry)} /><Badge variant={badge.variant}>{badge.label}</Badge></div></div>; })}
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <h4 className="mb-3 text-sm font-semibold">Konto anpassen</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="edit-vacation">Resturlaub (Tage)</Label><Input id="edit-vacation" type="number" min={0} max={365} value={editVacation} onChange={(event) => setEditVacation(event.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="edit-overtime">Korrektur Überstunden (h)</Label><Input id="edit-overtime" type="number" step="0.25" value={editOvertime} onChange={(event) => setEditOvertime(event.target.value)} /></div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Automatisch berechnet: {hoursToLabel(overtimeOf(selectedEmployee).auto)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{contractDetailsLine(selectedEmployee)} · {selectedEmployee.vacation_days_used ?? 0} Urlaubstage genutzt. Der neue Resturlaub wird in den Jahresanspruch umgerechnet.</p>
                <DialogFooter className="mt-4 sm:justify-end"><Button onClick={() => void saveAccount()} disabled={savingAccount}>{savingAccount ? "Wird gespeichert…" : "Speichern"}</Button></DialogFooter>
              </div>
            </div>}
          </DialogContent>
        </Dialog>

        <Dialog open={closingEntry !== null} onOpenChange={(open) => { if (!open) setClosingEntry(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Ausstempeln &amp; freigeben</DialogTitle>
              <DialogDescription>{closingEntry ? `Einstempeln vom ${new Date(closingEntry.clock_in).toLocaleDateString("de-DE")} um ${timeLabel(closingEntry.clock_in)} Uhr – aktuell noch offen. Setze die tatsächliche Endzeit, um die vergessene Ausstempelung zu beenden.` : ""}</DialogDescription>
            </DialogHeader>
            {closingEntry && <div className="min-w-0 space-y-4">
              <div className="min-w-0 space-y-2"><Label htmlFor="close-end">End-Uhrzeit</Label><Input id="close-end" type="datetime-local" value={closeEnd} onChange={(event) => setCloseEnd(event.target.value)} />{(() => { const daily = dailyMinutesOf(closingEntry); return daily !== null ? <p className="text-xs text-muted-foreground">Vorschlag: Soll-Tagesdauer {minutesToLabel(daily)} – Endzeit &amp; Pause anpassbar</p> : null; })()}</div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-2"><Label htmlFor="close-break">Pause (Minuten)</Label><Input id="close-break" type="number" min={0} max={1440} value={closeBreak} onChange={(event) => setCloseBreak(event.target.value)} /></div><div className="min-w-0 space-y-2"><Label htmlFor="close-reason">Grund der Änderung (optional, Audit-Log)</Label><Input id="close-reason" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} maxLength={500} placeholder="z. B. telefonisch nachgefragt" /></div></div>
              <div className="min-w-0 space-y-2"><Label htmlFor="close-note">Notiz (optional)</Label><Input id="close-note" value={closeNote} onChange={(event) => setCloseNote(event.target.value)} maxLength={500} /></div>
              {closeRequiredBreak > 0 && closeEnteredBreak < closeRequiredBreak && <p className="text-xs text-amber-700">Gemäß § 4 ArbZG wurden automatisch {closeRequiredBreak} Minuten Mindestpause berücksichtigt.</p>}
              <DialogFooter className="flex-wrap">
                <Button variant="outline" onClick={() => setClosingEntry(null)} disabled={saving !== null}>Abbrechen</Button>
                <Button variant="secondary" onClick={() => void closeEntry(false)} disabled={saving === closingEntry.id}>Nur ausstempeln</Button>
                <Button onClick={() => void closeEntry(true)} disabled={saving === closingEntry.id}><Check /> Ausstempeln &amp; Freigeben</Button>
              </DialogFooter>
            </div>}
          </DialogContent>
        </Dialog>

        {/* Bearbeiten / Nacherfassen eines Stempel-Eintrags (Admin) */}
        <Dialog open={formTarget !== null} onOpenChange={(open) => { if (!open) setFormTarget(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{formTarget?.entry ? "Stempelung bearbeiten" : "Eintrag nacherfassen"}</DialogTitle>
              <DialogDescription>{formTarget ? `${formTarget.employee.name} · ${formTarget.entry ? `Eintrag vom ${new Date(formTarget.entry.clock_in).toLocaleDateString("de-DE")} anpassen` : "Lege eine fehlende Stempelung manuell an (wird sofort freigegeben)."}` : ""}</DialogDescription>
            </DialogHeader>
            {formTarget && <div className="min-w-0 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-2"><Label htmlFor="form-start">Startzeit</Label><Input id="form-start" type="datetime-local" value={formStart} onChange={(event) => setFormStart(event.target.value)} /></div>
                <div className="min-w-0 space-y-2"><Label htmlFor="form-end">Endzeit{formTarget.entry && !formTarget.entry.clock_out ? " (offener Eintrag – leer lassen, um offen zu lassen)" : ""}</Label><Input id="form-end" type="datetime-local" value={formEnd} onChange={(event) => setFormEnd(event.target.value)} /></div>
              </div>
              <div className="min-w-0 space-y-2"><Label htmlFor="form-break">Pause (Minuten)</Label><Input id="form-break" type="number" min={0} max={1440} value={formBreak} onChange={(event) => setFormBreak(event.target.value)} /></div>
              <div className="min-w-0 space-y-2"><Label htmlFor="form-reason">Begründung (fürs Audit-Log, Pflicht)</Label><Input id="form-reason" value={formReason} onChange={(event) => setFormReason(event.target.value)} maxLength={500} placeholder={formTarget.entry ? "z. B. falsche Startzeit korrigiert" : "z. B. Mitarbeiter hat Stempeln vergessen"} /></div>
              {formRequiredBreak > 0 && Number(formBreak || 0) < formRequiredBreak && <p className="text-xs text-amber-700">Gemäß § 4 ArbZG werden automatisch mindestens {formRequiredBreak} Minuten Pause berücksichtigt.</p>}
              <DialogFooter className="flex-wrap">
                <Button variant="outline" onClick={() => setFormTarget(null)} disabled={savingEntryForm}>Abbrechen</Button>
                <Button onClick={() => void saveEntryForm()} disabled={savingEntryForm}>{savingEntryForm ? "Wird gespeichert…" : formTarget.entry ? "Speichern" : "Anlegen"}</Button>
              </DialogFooter>
            </div>}
          </DialogContent>
        </Dialog>

        <Dialog open={auditEntry !== null} onOpenChange={(open) => { if (!open) setAuditEntry(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Änderungshistorie</DialogTitle>
              <DialogDescription>{auditEntry ? `${auditEntry.profiles?.name ?? auditEntry.user_id} · Eintrag vom ${new Date(auditEntry.clock_in).toLocaleDateString("de-DE")}` : ""}</DialogDescription>
            </DialogHeader>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {!auditEntry?.audit_logs?.length ? <p className="text-sm text-muted-foreground">Keine Änderungen protokolliert.</p> : auditEntry.audit_logs.map((log) => <div key={log.id} className="rounded-lg border p-3 text-sm"><div className="flex flex-wrap items-center gap-1.5 font-medium"><History className="h-3.5 w-3.5 text-muted-foreground" />{formatAuditDate(log.changed_at)} · von {log.changed_by_name ?? "unbekannt"}{log.change_reason ? <Badge variant="secondary">{log.change_reason}</Badge> : null}</div><div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">{Object.entries(AUDIT_FIELD_LABELS).map(([key, label]) => { const oldV = log.old_values?.[key]; const newV = log.new_values?.[key]; if (auditValueLabel(key, oldV) === auditValueLabel(key, newV)) return null; return <p key={key}><span className="font-medium text-foreground">{label}:</span> {auditValueLabel(key, oldV)} → {auditValueLabel(key, newV)}</p>; })}</div></div>)}
            </div>
          </DialogContent>
        </Dialog>

        {/* Lösch-Bestätigung (gestalteter Dialog statt window.confirm) */}
        <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-destructive" /> Stempel-Eintrag löschen?</DialogTitle>
              <DialogDescription>{deleteTarget ? `Der Eintrag von ${deleteTarget.profiles?.name ?? deleteTarget.user_id} am ${new Date(deleteTarget.clock_in).toLocaleDateString("de-DE")} (${timeLabel(deleteTarget.clock_in)} – ${deleteTarget.clock_out ? timeLabel(deleteTarget.clock_out) : "offen"}) wird dauerhaft gelöscht.` : ""}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Abbrechen</Button>
              <Button variant="destructive" onClick={() => void deleteEntry()} disabled={deleting}>{deleting ? "Wird gelöscht…" : "Löschen"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </> : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <Card><CardContent className="flex items-center gap-3 p-5"><span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div></CardContent></Card>; }
