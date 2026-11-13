"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Coffee,
  FileClock,
  LoaderCircle,
  Send,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTRACT_LABELS, overtimeBalanceHours } from "@/lib/contract";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
import { nowServerAligned } from "@/lib/offline/clock";
import { hoursToLabel, minutesToLabel, workedMinutesOf } from "@/lib/time-format";
import type { ContractType } from "@/types/database";
import type { TimeEntry, TimeOffRequest, TimeOffType } from "@/types/time-tracking";

type ProfileSummary = {
  name: string;
  vacation_days_total: number;
  vacation_days_used: number;
  overtime_hours: number;
  contract_type: ContractType | null;
  weekly_target_hours: number | null;
  vacation_days_per_year: number | null;
};

type Summary = {
  profile: ProfileSummary & { id: string };
  entries: TimeEntry[];
  requests: TimeOffRequest[];
  colleagues: Array<{ id: string; name: string; role: string }>;
};

const TYPE_LABELS: Record<TimeOffType, string> = {
  vacation: "Vacation",
  sick_leave: "Sick leave",
  unpaid: "Unpaid leave",
  compensatory: "Time off in lieu",
};

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Vertrags-Label fürs Dashboard: Standard-Verträge zeigen nur den Namen
 * („Vollzeit“), individuelle Verträge zusätzlich das Soll („Individuell · 35 h/week“).
 */
function contractInfoLabel(profile: ProfileSummary): string {
  const label = CONTRACT_LABELS[profile.contract_type ?? "full_time"] ?? "Vollzeit";
  if (
    profile.contract_type === "custom" &&
    typeof profile.weekly_target_hours === "number"
  ) {
    return `${label} · ${profile.weekly_target_hours} h/week`;
  }
  return label;
}

export function TimeTrackingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<TimeOffType>("vacation");
  const [startDate, setStartDate] = useState(dateValue(new Date()));
  const [endDate, setEndDate] = useState(dateValue(new Date()));
  const [note, setNote] = useState("");
  const [substituteId, setSubstituteId] = useState("");
  const [sending, setSending] = useState(false);

  // „Arbeitszeit nachreichen“ (vergessene Stempelung)
  const [reDate, setReDate] = useState(dateValue(new Date()));
  const [reStart, setReStart] = useState("08:00");
  const [reEnd, setReEnd] = useState("17:00");
  const [reBreak, setReBreak] = useState("30");
  const [reNote, setReNote] = useState("");
  const [submittingEntry, setSubmittingEntry] = useState(false);

  // Stale-while-revalidate: gecachte Übersicht sofort anzeigen, frische
  // Daten parallel vom Server nachladen (fresh = nach einer Mutation erzwungen).
  const load = useCallback(async (fresh = false) => {
    const cached = fresh
      ? null
      : await offlineReadCached("/api/time-tracking/summary");
    if (cached?.profile) {
      setSummary(cached as Summary);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await offlineFetch("/api/time-tracking/summary", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load time tracking.");
      if (!body.profile) throw new Error("Employee profile is not in the cache yet.");
      setSummary(body as Summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load time tracking.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Nur freigegebene, abgeschlossene Einträge zählen (nachgereichte Arbeitszeit
  // zählt erst nach der Freigabe durch die Verwaltung).
  const weekMinutes = useMemo(() => {
    if (!summary) return 0;
    const start = startOfWeek(new Date()).getTime();
    return summary.entries
      .filter((entry) => entry.is_approved !== false && Date.parse(entry.clock_in) >= start)
      .reduce((total, entry) => total + workedMinutesOf(entry), 0);
  }, [summary]);
  const monthMinutes = useMemo(() => {
    if (!summary) return 0;
    const month = new Date();
    return summary.entries
      .filter((entry) => {
        if (entry.is_approved === false) return false;
        const date = new Date(entry.clock_in);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
      })
      .reduce((total, entry) => total + workedMinutesOf(entry), 0);
  }, [summary]);
  // Resturlaub = Jahresurlaubsanspruch (Vertrag) minus genutzte Tage.
  const vacationEntitlement =
    summary?.profile.vacation_days_per_year ?? summary?.profile.vacation_days_total ?? 0;
  const vacationRemaining = summary
    ? Math.max(0, vacationEntitlement - summary.profile.vacation_days_used)
    : 0;
  // Automatisch berechnet (Soll = weekly_target_hours, custom nutzt Profilwert)
  // + manuelle Korrektur der Verwaltung (overtime_hours).
  const overtimeBalance = summary
    ? overtimeBalanceHours(
        summary.entries,
        summary.profile.contract_type,
        summary.profile.weekly_target_hours ?? null,
      ) + Number(summary.profile.overtime_hours ?? 0)
    : 0;

  const colleagues = summary?.colleagues ?? [];
  const substituteOptions = [...colleagues]
    .filter((employee) => employee.id !== summary?.profile?.id)
    .sort((a, b) => Number(b.role === "substitute") - Number(a.role === "substitute") || a.name.localeCompare(b.name, "de"));

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (endDate < startDate) {
      toast.error("The end date cannot be before the start date.");
      return;
    }
    setSending(true);
    try {
      const timestamp = nowServerAligned();
      const res = await offlineFetch("/api/time-tracking/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, start_date: startDate, end_date: endDate, employee_note: note, substitute_id: substituteId || null, client_updated_at: timestamp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request could not be sent.");
      toast.success("Request submitted.");
      setNote("");
      setSubstituteId("");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    const start = new Date(`${reDate}T${reStart}:00`);
    // Liegt die Endzeit vor/auf der Startzeit, ist eine Übernacht-Stempelung
    // gemeint (z. B. 22:00 → 06:00 am Folgetag).
    let end = new Date(`${reDate}T${reEnd}:00`);
    // Übernacht-Stempelung: Datum um einen Tag erhöhen (setDate statt +24h,
    // damit die Uhrzeit auch an DST-Wechseltagen erhalten bleibt).
    if (end <= start) end.setDate(end.getDate() + 1);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      toast.error("The end time must be after the start time.");
      return;
    }
    const breakMinutes = Number(reBreak);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 24 * 60) {
      toast.error("Please enter a valid break time in minutes (0–1440).");
      return;
    }
    setSubmittingEntry(true);
    try {
      const timestamp = nowServerAligned();
      const res = await offlineFetch("/api/time-tracking/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clock_in: start.toISOString(),
          clock_out: end.toISOString(),
          break_duration_minutes: breakMinutes,
          note: reNote.trim() || null,
          client_updated_at: timestamp,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not submit work time.");
      toast.success("Work time submitted – waiting for approval.");
      setReDate(dateValue(new Date()));
      setReNote("");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit work time.");
    } finally {
      setSubmittingEntry(false);
    }
  }

  return (
    <div className="container py-6 sm:py-10">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">Mein Arbeitskonto</p>
          <h1 className="text-3xl font-bold tracking-tight">Time tracking</h1>
          <p className="mt-1 text-sm text-muted-foreground">Working hours, vacation and absences at a glance.</p>
        </div>
        {summary ? (
          <Badge variant="secondary" className="shrink-0">
            {contractInfoLabel(summary.profile)}
          </Badge>
        ) : null}
      </div>

      {loading && !summary ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading data…</div>
      ) : summary ? (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<CalendarDays />} label="Remaining vacation" value={`${vacationRemaining} days`} detail={`${summary.profile.vacation_days_used} by ${vacationEntitlement} Tagen genutzt`} />
            <MetricCard icon={<Coffee />} label="This week" value={minutesToLabel(weekMinutes)} />
            <MetricCard icon={<TimerReset />} label="This month" value={minutesToLabel(monthMinutes)} />
            <MetricCard icon={<FileClock />} label="Overtime account" value={hoursToLabel(overtimeBalance)} />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>My clock-ins</CardTitle><CardDescription>Current week and past working hours.</CardDescription></CardHeader>
              <CardContent>
                {summary.entries.length === 0 ? <p className="text-sm text-muted-foreground">No clock-ins yet.</p> : <div className="space-y-2">
                  {summary.entries.slice(0, 14).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3">
                    <div><p className="text-sm font-medium">{new Date(entry.clock_in).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</p><p className="text-xs text-muted-foreground">{new Date(entry.clock_in).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} – {entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "running"} · Break {entry.break_duration_minutes} min</p>{entry.note && <p className="mt-0.5 text-xs text-muted-foreground">Note: {entry.note}</p>}</div>
                    <div className="flex items-center gap-2"><Badge variant={entry.clock_out ? "secondary" : "success"}>{entry.clock_out ? minutesToLabel(workedMinutesOf(entry)) : "open"}</Badge>{entry.is_approved ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Approved" /> : <Badge variant="warning">Awaiting approval</Badge>}</div>
                  </div>)}
                </div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Request absence</CardTitle><CardDescription>Send vacation, sick leave or time off in lieu to the administration.</CardDescription></CardHeader>
              <CardContent><form className="space-y-4" onSubmit={submitRequest}>
                <div className="space-y-2"><Label>Art</Label><Select value={type} onValueChange={(value) => setType(value as TimeOffType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="absence-start">From</Label><Input id="absence-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="absence-end">Bis</Label><Input id="absence-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></div></div>
                <div className="space-y-2"><Label>Substitution by (optional)</Label><Select value={substituteId || "none"} onValueChange={(value) => setSubstituteId(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="No substitute" /></SelectTrigger><SelectContent><SelectItem value="none">No substitute</SelectItem>{substituteOptions.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name} · {employee.role === "substitute" ? "Springer" : employee.role === "facility_manager" ? "Reinigungskraft" : employee.role === "admin" ? "Admin" : "Driver"}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor="absence-note">Note (optional)</Label><Input id="absence-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Additional information" maxLength={1000} /></div>
                <Button type="submit" disabled={sending} className="w-full"><Send />{sending ? "Sending…" : "Submit request"}</Button>
              </form></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Add working hours</CardTitle><CardDescription>Enter a forgotten clock-in – it then waits for approval by the administration.</CardDescription></CardHeader>
              <CardContent><form className="space-y-4" onSubmit={submitEntry}>
                <div className="space-y-2"><Label htmlFor="entry-date">Date</Label><Input id="entry-date" type="date" value={reDate} onChange={(event) => setReDate(event.target.value)} required /></div>
                <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="entry-start">From</Label><Input id="entry-start" type="time" value={reStart} onChange={(event) => setReStart(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="entry-end">Bis</Label><Input id="entry-end" type="time" value={reEnd} onChange={(event) => setReEnd(event.target.value)} required /></div></div>
                <div className="space-y-2"><Label htmlFor="entry-break">Break (minutes)</Label><Input id="entry-break" type="number" min={0} max={1440} value={reBreak} onChange={(event) => setReBreak(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="entry-note">Note (optional)</Label><Input id="entry-note" value={reNote} onChange={(event) => setReNote(event.target.value)} placeholder="e.g. forgot to clock in" maxLength={500} /></div>
                <Button type="submit" disabled={submittingEntry} className="w-full"><Send />{submittingEntry ? "Sending…" : "Add working hours"}</Button>
              </form></CardContent>
            </Card>
          </div>

          <Card className="mt-6"><CardHeader><CardTitle>My requests</CardTitle></CardHeader><CardContent><div className="space-y-2">{summary.requests.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : summary.requests.slice(0, 12).map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3"><div><p className="text-sm font-medium">{TYPE_LABELS[request.type]} · {new Date(`${request.start_date}T00:00:00`).toLocaleDateString("en-GB")} – {new Date(`${request.end_date}T00:00:00`).toLocaleDateString("en-GB")}</p>{request.employee_note && <p className="text-xs text-muted-foreground">My note: {request.employee_note}</p>}{request.reviewer_note && <p className="text-xs font-medium text-primary">Answer: {request.reviewer_note}</p>}</div><Badge variant={request.status === "approved" ? "success" : request.status === "rejected" ? "destructive" : "warning"}>{request.status === "approved" ? "Approved" : request.status === "rejected" ? "Rejected" : "Pending"}</Badge></div>)}</div></CardContent></Card>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return <Card className="overflow-hidden"><CardContent className="flex items-start gap-3 p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span><div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div></CardContent></Card>;
}
