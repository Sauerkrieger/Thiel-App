"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, Search, ShieldCheck, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { offlineFetch } from "@/lib/offline/fetch";
import type { TimeEntry, TimeOffRequest } from "@/types/time-tracking";

type Employee = { id: string; name: string; role: string; vacation_days_total: number; vacation_days_used: number; overtime_hours: number; current_entry: TimeEntry | null; current_assignment?: { tour_id: string; tour_date: string; object_name: string | null } | null };
type Overview = { employees: Employee[]; entries: (TimeEntry & { profiles?: { name?: string; role?: string } | null })[]; requests: (TimeOffRequest & { profiles?: { name?: string; role?: string } | null })[] };

const ROLE_LABELS: Record<string, string> = { admin: "Admin", driver: "Fahrer", facility_manager: "Objektbetreuer", cleaner: "Reiniger", substitute: "Springer" };
const REQUEST_STATUS: Record<string, string> = { pending: "Ausstehend", approved: "Genehmigt", rejected: "Abgelehnt" };
const REQUEST_TYPE: Record<string, string> = { vacation: "Urlaub", sick_leave: "Krankheit", unpaid: "Unbezahlt", compensatory: "Freizeitausgleich" };

function minutes(entry: TimeEntry): number {
  if (!entry.clock_out) return 0;
  return Math.max(0, (Date.parse(entry.clock_out) - Date.parse(entry.clock_in)) / 60000 - entry.break_duration_minutes);
}
function hours(value: number): string { return `${(value / 60).toFixed(2).replace(".", ",")} h`; }

export function AdminTimeTrackingPage() {
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (role !== "all") params.set("role", role);
      if (query.trim()) params.set("q", query.trim());
      const res = await offlineFetch(`/api/admin/time-tracking/overview?${params.toString()}`, { cache: "no-store" });
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
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Arbeitszeit konnte nicht aktualisiert werden."); } finally { setSaving(null); }
  }

  async function reviewRequest(request: TimeOffRequest, status: "approved" | "rejected") {
    setSaving(request.id);
    try {
      const res = await offlineFetch(`/api/time-tracking/requests/${request.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Antrag konnte nicht aktualisiert werden.");
      await load();
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

  const openCount = overview?.employees.filter((employee) => employee.current_entry).length ?? 0;
  const pendingRequests = overview?.requests.filter((request) => request.status === "pending") ?? [];
  const pendingEntries = overview?.entries.filter((entry) => !entry.is_approved) ?? [];

  return (
    <div className="container py-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-sm font-medium text-primary">Verwaltung</p><h1 className="text-3xl font-bold tracking-tight">Zeitadmin</h1><p className="mt-1 text-sm text-muted-foreground">Mitarbeiterstatus, Freigaben und Lohnexport.</p></div><Button variant="outline" onClick={() => void downloadCsv()}><Download /> Lohn-CSV exportieren</Button></div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3"><Stat icon={<Users />} label="Mitarbeiter" value={String(overview?.employees.length ?? 0)} /><Stat icon={<UserCheck />} label="Gerade aktiv" value={String(openCount)} /><Stat icon={<ShieldCheck />} label="Offene Freigaben" value={String(pendingRequests.length + pendingEntries.length)} /></div>
      <Card className="mt-6"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mitarbeiter suchen…" /></div><Select value={role} onValueChange={setRole}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Rollen</SelectItem>{Object.entries(ROLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></CardContent></Card>

      {loading && !overview ? <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Übersicht wird geladen…</div> : overview ? <>
        <Card className="mt-6"><CardHeader><CardTitle>Mitarbeiterstatus</CardTitle><CardDescription>Wer ist aktuell eingestempelt?</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{overview.employees.map((employee) => <div key={employee.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{employee.name}</p><p className="text-xs text-muted-foreground">{ROLE_LABELS[employee.role] ?? employee.role}</p></div><Badge variant={employee.current_entry ? "success" : "secondary"}>{employee.current_entry ? "Aktiv" : "Nicht aktiv"}</Badge></div><p className="mt-4 text-sm text-muted-foreground">{employee.current_entry ? `Seit ${new Date(employee.current_entry.clock_in).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr` : `Resturlaub ${Math.max(0, employee.vacation_days_total - employee.vacation_days_used)} Tage`}</p>{employee.current_assignment && <p className="mt-1 text-xs text-primary">Tour {employee.current_assignment.tour_id.slice(0, 8)} · nächstes Objekt: {employee.current_assignment.object_name ?? "unbekannt"}</p>}<p className="mt-1 text-xs text-muted-foreground">Überstunden: {Number(employee.overtime_hours ?? 0).toFixed(2).replace(".", ",")} h</p></div>)}</div></CardContent></Card>
        <Card className="mt-6"><CardHeader><CardTitle>Freigabe-Feed</CardTitle><CardDescription>Arbeitszeiten und Anträge prüfen.</CardDescription></CardHeader><CardContent className="space-y-3">{pendingEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">Arbeitszeit · {entry.profiles?.name ?? entry.user_id}</p><p className="text-xs text-muted-foreground">{new Date(entry.clock_in).toLocaleDateString("de-DE")} · {entry.clock_out ? hours(minutes(entry)) : "offen"}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => void approveEntry(entry, true)} disabled={saving === entry.id}>Freigeben</Button></div></div>)}      {pendingRequests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{REQUEST_TYPE[request.type] ?? request.type} · {request.profiles?.name ?? request.user_id}</p><p className="text-xs text-muted-foreground">{new Date(`${request.start_date}T00:00:00`).toLocaleDateString("de-DE")} – {new Date(`${request.end_date}T00:00:00`).toLocaleDateString("de-DE")}</p>{request.employee_note && <p className="mt-1 text-xs text-muted-foreground">Notiz: {request.employee_note}</p>}</div><div className="flex gap-2"><Button size="sm" onClick={() => void reviewRequest(request, "approved")} disabled={saving === request.id}>Genehmigen</Button><Button size="sm" variant="outline" onClick={() => void reviewRequest(request, "rejected")} disabled={saving === request.id}>Ablehnen</Button></div></div>)}{pendingEntries.length === 0 && pendingRequests.length === 0 && <p className="text-sm text-muted-foreground">Keine offenen Freigaben.</p>}</CardContent></Card>
      </> : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <Card><CardContent className="flex items-center gap-3 p-5"><span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div></CardContent></Card>; }
