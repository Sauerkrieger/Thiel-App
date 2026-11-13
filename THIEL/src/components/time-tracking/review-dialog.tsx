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

function formatEntryTime(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
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
    setEndTime(toLocalInputValue(new Date()));
    setBreakMinutes("0");
    setNote("");
  }, [current]);

  // Gesetzliche Mindestpause (§ 4 ArbZG) für die gewählte Endzeit.
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
      toast.error("Bitte eine gültige End-Uhrzeit angeben.");
      return;
    }
    if (endMs <= Date.parse(current.clock_in)) {
      toast.error("Die Endzeit muss nach der Einstempelzeit liegen.");
      return;
    }
    const breakValue = Number(breakMinutes);
    if (
      !Number.isInteger(breakValue) ||
      breakValue < 0 ||
      breakValue > 24 * 60
    ) {
      toast.error("Bitte eine gültige Pausenzeit in Minuten angeben (0–1440).");
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
        throw new Error(body.error ?? "Nachreichen fehlgeschlagen.");
      }
      toast.success("Arbeitszeit nachgereicht – wartet auf Freigabe.");
      // Stempeluhr-Widget neu laden (die offene Stempelung ist nun beendet).
      window.dispatchEvent(new Event("thiel-clock-refresh"));
      const remaining = pending.filter((entry) => entry.id !== current.id);
      setPending(remaining);
      setCurrent(remaining[0] ?? null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Nachreichen fehlgeschlagen.",
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
            {formatEntryTime(current.clock_in)}. Bitte trage die tatsächliche
            Endzeit ein. Der Eintrag wird anschließend zur Freigabe an die
            Verwaltung eingereicht.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="review-end">Tatsächliche End-Uhrzeit</Label>
            <Input
              id="review-end"
              type="datetime-local"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-break">Pause (Minuten)</Label>
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
                Gemäß § 4 ArbZG wurden automatisch {requiredBreak} Minuten
                Mindestpause berücksichtigt.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-note">Notiz / Begründung (optional)</Label>
            <Input
              id="review-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="z. B. vergessen auszustempeln"
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
              {saving ? "Wird eingereicht…" : "Einreichen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
