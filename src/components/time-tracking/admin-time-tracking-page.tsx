"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock3, Download, LoaderCircle, Search, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTRACT_LABELS, overtimeBalanceHours } from "@/lib/contract";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
import { hoursToLabel, minutesToLabel, workedMinutesOf } from "@/lib/time-format";
import type { ContractType } from "@/types/database";
import type { TimeEntry, TimeOffRequest } from "@/types/time-tracking";

type Employee = { id: string; name: string; role: string; contract_type: ContractType | null; vacation_days_total: number; vacation_days_used: number; overtime_hours: number; current_entry: TimeEntry | null; current_assignment?: { tour_id: string; tour_date: string; object_name: string | null } | null };
type Overview = { employees: Employee[]; entries: (TimeEntry & { profiles?: { name?: string; role?: string } | null })[]; requests: (TimeOffRequest & { profiles?: { name?: string; role?: string } | null })[] };

const ROLE_LABELS: Record<string, string> = { admin: "Admin", driver: "Fahrer", facility_manager: "Reinigungskraft", substitute: "Springer" };
const REQUEST_TYPE: Record<string, string> = { vacation: "Urlaub", sick_leave: "Krankheit", unpaid: "Unbezahlt", compensatory: "Freizeitausgleich" };

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Status-Badge eines Stempel-Eintrags:
 * - Normale Stempelung (Stempeluhr) → „Gestempelt“
 * - Nachgereichte Arbeitszeit, freigegeben → „Freigegeben“
 * - Nachgereichte Arbeitszeit, offen → „Ausstehend“
 */
function entryBadge(entry: TimeEntry): { label: string; variant: "secondary" | "success" | "warning" } {
  if (entry.source === "submitted") {
    return entry.is_approved
      ? { label: "Freigegeben", variant: "success" }
      : { label: "Ausstehend", variant: "warning" };
  }
  return { label: "Gestempelt", variant: "secondary" };
}

export function AdminTimeTrackingPage() {
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
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

  // Stale-while-revalidate: gecachte Übersicht sofort anzeigen, frische
  // Daten parallel vom Server nachladen (fresh = nach einer Mutation erzwungen).
  const load = useCallback(async (fresh = false) => {
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (query.trim()) params.set("q", query.trim());
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
  }, [role, query]);

  useEffect(() => { void load(); }, [load]);

  async function approveEntry(entry: TimeEntry, approved: boolean) {
    setSaving(entry.id);
    try {
      const res = await offlineFetch(`/api/admin/time-tracking/entries/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_approved: approved }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Arbeitszeit konnte nicht aktualisiert werden.");
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Arbeitszeit konnte nicht aktualisiert werden."); } finally { setSaving(null); }
  }

  async function deleteEntry(entry: TimeEntry) {
    if (!window.confirm("Diesen Stempel-Eintrag wirklich löschen?")) return;
    setSaving(entry.id);
    try {
      const res = await offlineFetch(`/api/admin/time-tracking/entries/${entry.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Eintrag konnte nicht gelöscht werden.");
      toast.success("Eintrag gelöscht.");
      await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Eintrag konnte nicht gelöscht werden."); } finally { setSaving(null); }
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
    setEditVacation(String(Math.max(0, (employee.vacation_days_total ?? 0) - (employee.vacation_days_used ?? 0))));
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
          // Der Anspruch ergibt sich aus genutzten Tagen + neuem Resturlaub.
          vacation_days_total: (selectedEmployee.vacation_days_used ?? 0) + remaining,
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
  const pendingEntries = overview?.entries.filter((entry) => entry.source === "submitted" && !entry.is_approved) ?? [];

  /** Überstunden eines Mitarbeiters: automatisch (Stempelungen & Vertragsart) + Korrektur. */
  function overtimeOf(employee: Employee): { auto: number; correction: number; total: number } {
    if (!overview) return { auto: 0, correction: 0, total: 0 };
    const entries = overview.entries.filter((entry) => entry.user_id === employee.id);
    const auto = overtimeBalanceHours(entries, employee.contract_type);
    const correction = Number(employee.overtime_hours ?? 0);
    return { auto, correction, total: auto + correction };
  }

  function contractLabel(employee: Employee): string {
    return CONTRACT_LABELS[employee.contract_type ?? "full_time"] ?? "Vollzeit";
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
      <div className="mt-8 grid gap-4 sm:grid-cols-3"><Stat icon={<Users />} label="Mitarbeiter" value={String(overview?.employees.length ?? 0)} /><Stat icon={<UserCheck />} label="Gerade aktiv" value={String(openCount)} /><Stat icon={<ShieldCheck />} label="Offene Freigaben" value={String(pendingRequests.length + pendingEntries.length)} /></div>
      <Card className="mt-6"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mitarbeiter suchen…" /></div><Select value={role} onValueChange={setRole}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Rollen</SelectItem>{Object.entries(ROLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></CardContent></Card>

      {loading && !overview ? <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Übersicht wird geladen…</div> : overview ? <>
        <Card className="mt-6"><CardHeader><CardTitle>Mitarbeiterstatus</CardTitle><CardDescription>Wer ist aktuell eingestempelt? Klicke auf eine Karte für Stempelhistorie und Kontokorrektur.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{overview.employees.map((employee) => <button key={employee.id} type="button" onClick={() => openEmployee(employee)} className="group w-full rounded-xl border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{employee.name}</p><p className="text-xs text-muted-foreground">{ROLE_LABELS[employee.role] ?? employee.role}</p></div><div className="flex items-center gap-1.5"><Badge variant={employee.current_entry ? "success" : "secondary"}>{employee.current_entry ? "Aktiv" : "Nicht aktiv"}</Badge><ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div></div><p className="mt-4 text-sm text-muted-foreground">{employee.current_entry ? `Seit ${timeLabel(employee.current_entry.clock_in)} Uhr` : `Resturlaub ${Math.max(0, (employee.vacation_days_total ?? 0) - (employee.vacation_days_used ?? 0))} Tage`}</p>{employee.current_assignment && <p className="mt-1 text-xs text-primary">Tour {employee.current_assignment.tour_id.slice(0, 8)} · nächstes Objekt: {employee.current_assignment.object_name ?? "unbekannt"}</p>}<p className="mt-1 text-xs text-muted-foreground">Überstunden: {hoursToLabel(overtimeOf(employee).total)} · {contractLabel(employee)}</p></button>)}</div></CardContent></Card>

        <Card className="mt-6"><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-3"><span>Monatsübersicht</span><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 w-44" aria-label="Monat wählen" /></CardTitle><CardDescription>Gesamtarbeitszeit aller Mitarbeiter im gewählten Monat (freigegebene, abgeschlossene Einträge).</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Mitarbeiter</TableHead><TableHead>Rolle</TableHead><TableHead className="text-right">Tage</TableHead><TableHead className="text-right">Arbeitszeit</TableHead></TableRow></TableHeader><TableBody>{monthRows.map((row) => <TableRow key={row.employee.id}><TableCell className="font-medium">{row.employee.name}</TableCell><TableCell className="text-muted-foreground">{ROLE_LABELS[row.employee.role] ?? row.employee.role}</TableCell><TableCell className="text-right">{row.days}</TableCell><TableCell className="text-right font-mono">{minutesToLabel(row.total)}</TableCell></TableRow>)}</TableBody><TableFooter><TableRow><TableCell colSpan={3}>Gesamt ({monthRows.length} Mitarbeiter)</TableCell><TableCell className="text-right font-mono">{minutesToLabel(monthTotal)}</TableCell></TableRow></TableFooter></Table></CardContent></Card>

        <Card className="mt-6"><CardHeader><CardTitle>Freigabe-Feed</CardTitle><CardDescription>Nachgereichte Arbeitszeiten und Anträge prüfen.</CardDescription></CardHeader><CardContent className="space-y-3">{pendingEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="flex items-center gap-1.5 text-sm font-medium"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />Nachgereichte Arbeitszeit · {entry.profiles?.name ?? entry.user_id}</p><p className="text-xs text-muted-foreground">{new Date(entry.clock_in).toLocaleDateString("de-DE")} · {timeLabel(entry.clock_in)} – {entry.clock_out ? timeLabel(entry.clock_out) : "offen"}{entry.break_duration_minutes > 0 ? ` · Pause ${entry.break_duration_minutes} Min.` : ""}{entry.clock_out ? ` · ${minutesToLabel(workedMinutesOf(entry))}` : ""}</p>{entry.note && <p className="mt-1 text-xs text-muted-foreground">Notiz: {entry.note}</p>}</div><div className="flex gap-2"><Button size="sm" onClick={() => void approveEntry(entry, true)} disabled={saving === entry.id}><Check /> Freigeben</Button><Button size="sm" variant="outline" onClick={() => void deleteEntry(entry)} disabled={saving === entry.id}><Trash2 /> Löschen</Button></div></div>)}
      {pendingRequests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{REQUEST_TYPE[request.type] ?? request.type} · {request.profiles?.name ?? request.user_id}</p><p className="text-xs text-muted-foreground">{new Date(`${request.start_date}T00:00:00`).toLocaleDateString("de-DE")} – {new Date(`${request.end_date}T00:00:00`).toLocaleDateString("de-DE")}</p>{request.employee_note && <p className="mt-1 text-xs text-muted-foreground">Notiz: {request.employee_note}</p>}</div><div className="flex gap-2"><Button size="sm" onClick={() => void reviewRequest(request, "approved")} disabled={saving === request.id}>Genehmigen</Button><Button size="sm" variant="outline" onClick={() => void reviewRequest(request, "rejected")} disabled={saving === request.id}>Ablehnen</Button></div></div>)}{pendingEntries.length === 0 && pendingRequests.length === 0 && <p className="text-sm text-muted-foreground">Keine offenen Freigaben.</p>}</CardContent></Card>

        <Dialog open={selectedEmployee !== null} onOpenChange={(open) => { if (!open) setSelectedEmployee(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedEmployee?.name}</DialogTitle>
              <DialogDescription>{selectedEmployee ? `${ROLE_LABELS[selectedEmployee.role] ?? selectedEmployee.role} · ${contractLabel(selectedEmployee)} · Resturlaub ${Math.max(0, (selectedEmployee.vacation_days_total ?? 0) - (selectedEmployee.vacation_days_used ?? 0))} Tage · Überstunden ${hoursToLabel(overtimeOf(selectedEmployee).total)}` : ""}</DialogDescription>
            </DialogHeader>
            {selectedEmployee && <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-semibold">Stempelhistorie</h4>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {employeeEntries.length === 0 ? <p className="text-sm text-muted-foreground">Keine Stempelungen vorhanden.</p> : employeeEntries.map((entry) => { const badge = entryBadge(entry); return <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"><div><p className="font-medium">{new Date(entry.clock_in).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</p><p className="text-xs text-muted-foreground">{timeLabel(entry.clock_in)} – {entry.clock_out ? timeLabel(entry.clock_out) : "läuft gerade"}{entry.break_duration_minutes > 0 ? ` · Pause ${entry.break_duration_minutes} Min.` : ""}</p></div><div className="flex items-center gap-2"><span className="font-mono text-xs">{entry.clock_out ? minutesToLabel(workedMinutesOf(entry)) : "offen"}</span><Badge variant={badge.variant}>{badge.label}</Badge></div></div>; })}
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <h4 className="mb-3 text-sm font-semibold">Konto anpassen</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="edit-vacation">Resturlaub (Tage)</Label><Input id="edit-vacation" type="number" min={0} max={365} value={editVacation} onChange={(event) => setEditVacation(event.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="edit-overtime">Korrektur Überstunden (h)</Label><Input id="edit-overtime" type="number" step="0.25" value={editOvertime} onChange={(event) => setEditOvertime(event.target.value)} /></div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Automatisch berechnet: {hoursToLabel(overtimeOf(selectedEmployee).auto)}</p>
                <p className="mt-2 text-xs text-muted-foreground">Urlaubsanspruch gesamt: {selectedEmployee.vacation_days_total ?? 0} Tage ({selectedEmployee.vacation_days_used ?? 0} genutzt). Der neue Resturlaub wird in den Gesamtanspruch umgerechnet.</p>
                <DialogFooter className="mt-4 sm:justify-end"><Button onClick={() => void saveAccount()} disabled={savingAccount}>{savingAccount ? "Wird gespeichert…" : "Speichern"}</Button></DialogFooter>
              </div>
            </div>}
          </DialogContent>
        </Dialog>
      </> : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <Card><CardContent className="flex items-center gap-3 p-5"><span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div></CardContent></Card>; }
