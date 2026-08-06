"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coffee, LoaderCircle, Play, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { offlineFetch } from "@/lib/offline/fetch";
import { nowServerAligned } from "@/lib/offline/clock";
import type { TimeEntry } from "@/types/time-tracking";

type Props = { compact?: boolean; userId?: string | null };

function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

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

  if (loading) return <span className="hidden sm:inline-flex"><LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /></span>;

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
      <Badge variant="success" className="h-8 gap-1 px-2 font-mono text-xs">
        <Timer className="h-3.5 w-3.5" />
        {formatDuration(shownMinutes)} h
      </Badge>
      <Button variant="ghost" size="icon" onClick={togglePause} disabled={busy} className="h-8 w-8" title={pausedAt ? "Pause beenden" : "Pause starten"}>
        <Coffee className={pausedAt ? "h-4 w-4 text-amber-600" : "h-4 w-4"} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => void clockOut()} disabled={busy} className="h-8 w-8 text-destructive hover:text-destructive" title="Ausstempeln">
        <Square className="h-3.5 w-3.5 fill-current" />
      </Button>
      {!compact && pausedAt && <span className="text-xs text-amber-700">Pause</span>}
    </div>
  );
}
