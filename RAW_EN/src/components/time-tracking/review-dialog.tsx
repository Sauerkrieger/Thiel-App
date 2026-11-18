"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { offlineFetch } from "@/lib/offline/fetch";
import { nowServerAligned } from "@/lib/offline/clock";
import { requiredBreakMinutes } from "@/lib/time-format";
import type { TimeEntry } from "@/types/time-tracking";

/** Datum/Uhrzeit als Wert für ein <input type="datetime-local"> (lokale Zeit). */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Vorbelegte Endzeit einer vergessenen Ausstempelung: **gleicher Kalendertag
 * wie das Einstempeln** (Uhrzeit: jetzt). Vorher war es „heute“ – wer im
 * Popup nur die Uhrzeit änderte und das Datum übersah, speicherte das Ende
 * Tage später und erzeugte Dauern wie „74:37 h“.
 */
function defaultEndForEntry(clockIn: string): Date {
  const start = new Date(clockIn);
  const now = new Date();
  if (Number.isNaN(start.getTime())) return now;
  const candidate = new Date(start);
  candidate.setHours(now.getHours(), now.getMinutes(), 0, 0);
  // Uhrzeit liegt vor dem Einstempeln → Folgetag (Übernacht-Stempelung).
  if (candidate.getTime() <= start.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  // Nie in der Zukunft: dann lieber der aktuelle Zeitpunkt.
  return candidate.getTime() > now.getTime() ? now : candidate;
}

function formatEntryTime(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Zwangspopup „Vergessen auszustempeln?“
 *
 * Wird beim App-Start angezeigt, wenn für den Nutzer ungelöste, prüfbedürftige
 * Stempelungen vorliegen (requires_review = true, is_approved = false und noch
 * OFFEN – hat der Admin bereits korrigiert oder der Nutzer schon geantwortet,
 * erscheint kein Popup). Das Popup ist bewusst NICHT schließbar: Erst das
 * Absenden der tatsächlichen Endzeit (mit Pause/Notiz) beendet es. Der Eintrag
 * geht danach als „Nachgereicht / Warten auf Freigabe“ in den Freigabe-Feed.
 */
export function TimeReviewDialog({ userId }: { userId: string | null }) {
  const [pending, setPending] = useState<TimeEntry[]>([]);
  const [current, setCurrent] = useState<TimeEntry | null>(null);
  const [endTime, setEndTime] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await offlineFetch("/api/time-tracking/review", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      const entries = Array.isArray(body.entries) ? body.entries : [];
      setPending(entries);
      setCurrent(entries[0] ?? null);
    } catch {
      // Offline / Fehler: kein Popup – der nächste Online-Start prüft erneut.
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Erneute Prüfung bei Rückkehr in den Tab / Fokus – so erscheint das Popup
  // auch, wenn die Stempelung erst mitten in der Sitzung überfällig wurde
  // (z. B. 12-Stunden-Marke erreicht, während die App offen ist).
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      window.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [load]);

  // Formular je Eintrag zurücksetzen.
  useEffect(() => {
    if (!current) return;
    setEndTime(toLocalInputValue(defaultEndForEntry(current.clock_in)));
    setBreakMinutes("0");
    setNote("");
  }, [current]);

     // Statutory minimum break (UK WTR) for the selected end time.
  const requiredBreak =
    current && endTime && !Number.isNaN(new Date(endTime).getTime())
      ? requiredBreakMinutes(current.clock_in, new Date(endTime).toISOString())
      : 0;
  const enteredBreak = Number(breakMinutes) || 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current) return;
    const endMs = new Date(endTime).getTime();
    if (!endTime || Number.isNaN(endMs)) {
      toast.error("Please enter a valid end time.");
      return;
    }
    if (endMs <= Date.parse(current.clock_in)) {
      toast.error("The end time must be after the clock-in time.");
      return;
    }
    const breakValue = Number(breakMinutes);
    if (
      !Number.isInteger(breakValue) ||
      breakValue < 0 ||
      breakValue > 24 * 60
    ) {
      toast.error("Please enter a valid break time in minutes (0–1440).");
      return;
    }
    setSaving(true);
    try {
      const res = await offlineFetch(
        `/api/time-tracking/entries/${current.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clock_out: new Date(endMs).toISOString(),
            break_duration_minutes: breakValue,
            note: note.trim() || null,
            client_updated_at: nowServerAligned(),
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = der Admin hat den Eintrag inzwischen geschlossen/freigegeben:
        // Liste neu laden – das Popup schließt sich dann von selbst.
        if (res.status === 409) {
          await load();
          return;
        }
        throw new Error(body.error ?? "Submission failed.");
      }
      toast.success("Work time submitted – waiting for approval.");
      // Stempeluhr-Widget neu laden (die offene Stempelung ist nun beendet).
      window.dispatchEvent(new Event("app-clock-refresh"));
      const remaining = pending.filter((entry) => entry.id !== current.id);
      setPending(remaining);
      setCurrent(remaining[0] ?? null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Submission failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Vergessen auszustempeln?
          </DialogTitle>
          <DialogDescription>
            Du hast vergessen auszustempeln – Einstempelung vom{" "}
            {formatEntryTime(current.clock_in)}. Please enter the actual
            end time. The entry is then sent for approval to the
            Verwaltung eingereicht.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="review-end">Actual end time</Label>
            <Input
              id="review-end"
              type="datetime-local"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-break">Break (minutes)</Label>
            <Input
              id="review-break"
              type="number"
              min={0}
              max={1440}
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
            />
            {requiredBreak > 0 && enteredBreak < requiredBreak && (
              <p className="text-xs text-amber-700">
                Under the UK Working Time Regulations, {requiredBreak} minutes
                of minimum break were applied automatically.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-note">Note / reason (optional)</Label>
            <Input
              id="review-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. forgot to clock out"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {saving ? "Submitting…" : "Einreichen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
