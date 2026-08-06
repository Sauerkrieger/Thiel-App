"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
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
import { offlineFetch } from "@/lib/offline/fetch";
import { getCurrentUserId } from "@/lib/offline/sync";
import { nowServerAligned } from "@/lib/offline/clock";
import type { TimeEntry, TimeOffRequest, TimeOffType } from "@/types/time-tracking";
import { ClockWidget } from "./clock-widget";

type ProfileSummary = {
  name: string;
  vacation_days_total: number;
  vacation_days_used: number;
  overtime_hours: number;
};

type Summary = {
  profile: ProfileSummary;
  entries: TimeEntry[];
  requests: TimeOffRequest[];
};

const TYPE_LABELS: Record<TimeOffType, string> = {
  vacation: "Urlaub",
  sick_leave: "Krankheit",
  unpaid: "Unbezahlte Abwesenheit",
  compensatory: "Freizeitausgleich",
};

function formatHours(minutes: number): string {
  return `${(Math.max(0, minutes) / 60).toFixed(2).replace(".", ",")} h`;
}

function workedMinutes(entry: TimeEntry): number {
  if (!entry.clock_out) return 0;
  return Math.max(0, (Date.parse(entry.clock_out) - Date.parse(entry.clock_in)) / 60000 - entry.break_duration_minutes);
}

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

export function TimeTrackingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<TimeOffType>("vacation");
  const [startDate, setStartDate] = useState(dateValue(new Date()));
  const [endDate, setEndDate] = useState(dateValue(new Date()));
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await offlineFetch("/api/time-tracking/summary", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Zeiterfassung konnte nicht geladen werden.");
      if (!body.profile) throw new Error("Mitarbeiterprofil ist noch nicht im Cache verfügbar.");
      setSummary(body as Summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zeiterfassung konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const weekMinutes = useMemo(() => {
    if (!summary) return 0;
    const start = startOfWeek(new Date()).getTime();
    return summary.entries.filter((entry) => Date.parse(entry.clock_in) >= start).reduce((total, entry) => total + workedMinutes(entry), 0);
  }, [summary]);
  const monthMinutes = useMemo(() => {
    if (!summary) return 0;
    const month = new Date();
    return summary.entries.filter((entry) => {
      const date = new Date(entry.clock_in);
      return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
    }).reduce((total, entry) => total + workedMinutes(entry), 0);
  }, [summary]);
  const vacationRemaining = summary ? Math.max(0, summary.profile.vacation_days_total - summary.profile.vacation_days_used) : 0;

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (endDate < startDate) {
      toast.error("Das Enddatum darf nicht vor dem Startdatum liegen.");
      return;
    }
    setSending(true);
    try {
      const timestamp = nowServerAligned();
      const res = await offlineFetch("/api/time-tracking/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, start_date: startDate, end_date: endDate, employee_note: note, client_updated_at: timestamp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Antrag konnte nicht gesendet werden.");
      toast.success("Antrag wurde eingereicht.");
      setNote("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Antrag konnte nicht gesendet werden.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container py-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">Mein Arbeitskonto</p>
          <h1 className="text-3xl font-bold tracking-tight">Zeiterfassung</h1>
          <p className="mt-1 text-sm text-muted-foreground">Arbeitszeit, Urlaub und Abwesenheiten auf einen Blick.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-sm">
          <Clock3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Stempeluhr</span>
          <ClockWidget compact={false} userId={getCurrentUserId()} />
        </div>
      </div>

      {loading && !summary ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Daten werden geladen…</div>
      ) : summary ? (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<CalendarDays />} label="Resturlaub" value={`${vacationRemaining} Tage`} detail={`${summary.profile.vacation_days_used} von ${summary.profile.vacation_days_total} Tagen genutzt`} />
            <MetricCard icon={<Coffee />} label="Diese Woche" value={formatHours(weekMinutes)} detail="Abgeschlossene Stempelungen" />
            <MetricCard icon={<TimerReset />} label="Dieser Monat" value={formatHours(monthMinutes)} detail="Abgeschlossene Stempelungen" />
            <MetricCard icon={<FileClock />} label="Überstundenkonto" value={`${Number(summary.profile.overtime_hours ?? 0).toFixed(2).replace(".", ",")} h`} detail="Von der Verwaltung gepflegt" />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader><CardTitle>Meine Stempelungen</CardTitle><CardDescription>Aktuelle Woche und vergangene Arbeitszeiten.</CardDescription></CardHeader>
              <CardContent>
                {summary.entries.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Stempelungen vorhanden.</p> : <div className="space-y-2">
                  {summary.entries.slice(0, 14).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3">
                    <div><p className="text-sm font-medium">{new Date(entry.clock_in).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</p><p className="text-xs text-muted-foreground">{new Date(entry.clock_in).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} – {entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "läuft gerade"} · Pause {entry.break_duration_minutes} Min.</p></div>
                    <div className="flex items-center gap-2"><Badge variant={entry.clock_out ? "secondary" : "success"}>{entry.clock_out ? formatHours(workedMinutes(entry)) : "offen"}</Badge>{entry.is_approved && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Freigegeben" />}</div>
                  </div>)}
                </div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Abwesenheit beantragen</CardTitle><CardDescription>Urlaub, Krankheit oder Freizeitausgleich an die Verwaltung senden.</CardDescription></CardHeader>
              <CardContent><form className="space-y-4" onSubmit={submitRequest}>
                <div className="space-y-2"><Label>Art</Label><Select value={type} onValueChange={(value) => setType(value as TimeOffType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="absence-start">Von</Label><Input id="absence-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="absence-end">Bis</Label><Input id="absence-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></div></div>
                <div className="space-y-2"><Label htmlFor="absence-note">Notiz (optional)</Label><Input id="absence-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Zusätzliche Information" maxLength={1000} /></div>
                <Button type="submit" disabled={sending} className="w-full"><Send />{sending ? "Wird gesendet…" : "Antrag einreichen"}</Button>
              </form></CardContent>
            </Card>
          </div>

          <Card className="mt-6"><CardHeader><CardTitle>Meine Anträge</CardTitle></CardHeader><CardContent><div className="space-y-2">{summary.requests.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Anträge.</p> : summary.requests.slice(0, 12).map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3"><div><p className="text-sm font-medium">{TYPE_LABELS[request.type]} · {new Date(`${request.start_date}T00:00:00`).toLocaleDateString("de-DE")} – {new Date(`${request.end_date}T00:00:00`).toLocaleDateString("de-DE")}</p>{request.employee_note && <p className="text-xs text-muted-foreground">Meine Notiz: {request.employee_note}</p>}{request.reviewer_note && <p className="text-xs font-medium text-primary">Antwort: {request.reviewer_note}</p>}</div><Badge variant={request.status === "approved" ? "success" : request.status === "rejected" ? "destructive" : "warning"}>{request.status === "approved" ? "Genehmigt" : request.status === "rejected" ? "Abgelehnt" : "Ausstehend"}</Badge></div>)}</div></CardContent></Card>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <Card className="overflow-hidden"><CardContent className="flex items-start gap-3 p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span><div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>;
}
