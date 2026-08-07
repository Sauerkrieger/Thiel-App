"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coffee, LoaderCircle, Play, Plus, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { offlineFetch } from "@/lib/offline/fetch";
import { nowServerAligned } from "@/lib/offline/clock";
import { minutesToLabel } from "@/lib/time-format";
import type { TimeEntry } from "@/types/time-tracking";

type Props = { compact?: boolean; userId?: string | null };

function elapsedMinutes(entry: TimeEntry, now: number): number {
  const end = entry.clock_out ? Date.parse(entry.clock_out) : now;
  return Math.max(0, (end - Date.parse(entry.clock_in)) / 60000 - entry.break_duration_minutes);
}

export function ClockWidget({ compact = true, userId = null }: Props) {
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pauseMinutes, setPauseMinutes] = useState(0);
  // Reset-Schlüssel des Pausen-Presets, damit nach einer Auswahl wieder der
  // Platzhalter erscheint (Select ist unkontrolliert).
  const [pausePresetKey, setPausePresetKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await offlineFetch("/api/time-tracking/clock", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setEntry(body.entry ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const pauseKey = `thiel-clock-pause:${userId ?? "anonymous"}`;
    const pauseMinutesKey = `thiel-clock-pause-minutes:${userId ?? "anonymous"}`;
    const storedPause = window.localStorage.getItem(pauseKey);
    const storedMinutes = Number(window.localStorage.getItem(pauseMinutesKey) ?? "0");
    if (Number.isFinite(storedMinutes) && storedMinutes >= 0) setPauseMinutes(storedMinutes);
    if (!storedPause) return;
    const parsed = Number(storedPause);
    if (Number.isFinite(parsed) && parsed > 0) setPausedAt(parsed);
  }, []);

  const minutes = useMemo(
    () => (entry ? elapsedMinutes(entry, now) : 0),
    [entry, now],
  );
  const livePauseMinutes = pausedAt ? Math.max(0, (Date.now() - pausedAt) / 60000) : 0;
  const shownMinutes = Math.max(0, minutes - pauseMinutes - livePauseMinutes);

  async function clockIn() {
    setBusy(true);
    try {
      const eventAt = nowServerAligned();
      const response = await offlineFetch("/api/time-tracking/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clock_in", event_at: eventAt, client_updated_at: eventAt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Einstempeln fehlgeschlagen.");
      setEntry(body.entry ?? null);
      toast.success("Arbeitszeit gestartet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Einstempeln fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function clockOut() {
    setBusy(true);
    try {
      const eventAt = nowServerAligned();
      const finalPause = pauseMinutes + (pausedAt ? Math.max(0, Math.round((Date.now() - pausedAt) / 60000)) : 0);
      const response = await offlineFetch("/api/time-tracking/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clock_out",
          event_at: eventAt,
          client_updated_at: eventAt,
          break_duration_minutes: finalPause,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Ausstempeln fehlgeschlagen.");
      setEntry(null);
      setPauseMinutes(0);
      setPausedAt(null);
      window.localStorage.removeItem(`thiel-clock-pause:${userId ?? "anonymous"}`);
      window.localStorage.removeItem(`thiel-clock-pause-minutes:${userId ?? "anonymous"}`);
      toast.success("Arbeitszeit beendet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ausstempeln fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  function togglePause() {
    if (pausedAt) {
      setPauseMinutes((current) => {
        const next = current + Math.max(0, Math.round((Date.now() - pausedAt) / 60000));
        window.localStorage.setItem(`thiel-clock-pause-minutes:${userId ?? "anonymous"}`, String(next));
        return next;
      });
      setPausedAt(null);
      window.localStorage.removeItem(`thiel-clock-pause:${userId ?? "anonymous"}`);
      return;
    }
    const timestamp = Date.now();
    setPausedAt(timestamp);
    window.localStorage.setItem(`thiel-clock-pause:${userId ?? "anonymous"}`, String(timestamp));
    window.localStorage.setItem(`thiel-clock-pause-minutes:${userId ?? "anonymous"}`, String(pauseMinutes));
  }

  /** Feste Pausenzeit ergänzen (z. B. vergessene Pause): wird von der Arbeitszeit abgezogen. */
  function addPauseMinutes(additional: number) {
    setPauseMinutes((current) => {
      const next = current + additional;
      window.localStorage.setItem(`thiel-clock-pause-minutes:${userId ?? "anonymous"}`, String(next));
      return next;
    });
    setPausePresetKey((key) => key + 1);
    toast.success(`${additional} Min. Pause ergänzt.`);
  }

  // Spinner immer sichtbar: Am Desktop steht das Widget im Header, am Handy in
  // der unteren Stempeluhr-Leiste (AppShell) – in beiden Fällen soll beim
  // Laden ein Indikator erscheinen.
  if (loading) return <span className="inline-flex"><LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /></span>;

  if (!entry) {
    return (
      <Button variant="outline" size="sm" onClick={() => void clockIn()} disabled={busy} className="h-8 gap-1.5 px-2 text-xs">
        <Play className="h-3.5 w-3.5 text-success" />
        <span className="hidden sm:inline">Einstempeln</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="success" className="h-8 min-w-[4.75rem] shrink-0 justify-center gap-1.5 whitespace-nowrap px-3 font-mono text-xs">
        <Timer className="h-3.5 w-3.5" />
        {minutesToLabel(shownMinutes)}
      </Badge>
      <Button variant="ghost" size="icon" onClick={togglePause} disabled={busy} className="h-8 w-10" title={pausedAt ? "Pause beenden" : "Pause starten"}>
        <Coffee className={pausedAt ? "h-4 w-4 text-amber-600" : "h-4 w-4"} />
      </Button>
      <Select
        key={pausePresetKey}
        onValueChange={(value) => addPauseMinutes(Number(value))}
        disabled={busy}
      >
        <SelectTrigger
          className="h-8 w-8 justify-center px-0 text-xs [&>span]:hidden [&>svg:last-child]:hidden"
          title="Pausenzeit eintragen/abziehen (z. B. vergessene Pause)"
          aria-label="Pausenzeit hinzufügen"
        >
          <Plus className="h-3.5 w-3.5" />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="15">+15 Min</SelectItem>
          <SelectItem value="30">+30 Min</SelectItem>
          <SelectItem value="45">+45 Min</SelectItem>
          <SelectItem value="60">+60 Min</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" onClick={() => void clockOut()} disabled={busy} className="h-8 w-8 text-destructive hover:text-destructive" title="Ausstempeln">
        <Square className="h-3.5 w-3.5 fill-current" />
      </Button>
      {!compact && pausedAt && <span className="text-xs text-amber-700">Pause</span>}
    </div>
  );
}
