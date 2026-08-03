"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  MapPin,
  Play,
  Route,
  Save,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupHint } from "@/components/setup-hint";
import { PhotoSelectDialog } from "./photo-select-dialog";
import { PackView } from "./pack-view";
import { PackDialog } from "./pack-dialog";
import {
  formatMinutes,
  toMinutes,
} from "@/lib/routing/time";
import type { DayOfWeek } from "@/types/database";
import type {
  ApiError,
  OptimizedStop,
  PhotoMatch,
  PlanningObject,
  RouteOptimizationResult,
} from "@/types/api";

const WEEKDAY_NAMES = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
});

export function PlanningPage() {
  const router = useRouter();

  // 0 = Sonntag ... 6 = Samstag (JS getDay() = DB-Konvention)
  const dayOfWeek = new Date().getDay() as DayOfWeek;

  const [objects, setObjects] = useState<PlanningObject[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [defaultsUpdatedAt, setDefaultsUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Routen-Optimierung / Pack-Modus
  const [optimizing, setOptimizing] = useState(false);
  const [route, setRoute] = useState<RouteOptimizationResult | null>(null);
  const [packDialog, setPackDialog] = useState<{
    open: boolean;
    objectId: string | null;
    objectName: string | null;
  }>({ open: false, objectId: null, objectName: null });
  const [startingTour, setStartingTour] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  const todayLabel = useMemo(() => dateFormatter.format(new Date()), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/planning?day_of_week=${dayOfWeek}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setError({ code: body.code, message: body.error ?? "Unbekannter Fehler" });
        return;
      }
      setObjects(body.objects ?? []);
      const ids: string[] = body.selected_ids ?? [];
      setSelected(new Set(ids));
      setSavedIds(ids);
      setDefaultsUpdatedAt(body.defaults_updated_at ?? null);
    } catch {
      setError({ message: "Netzwerkfehler beim Laden der Tourenplanung." });
    } finally {
      setLoading(false);
    }
  }, [dayOfWeek]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (selected.size !== savedIds.length) return true;
    return savedIds.some((id) => !selected.has(id));
  }, [selected, savedIds]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/planning", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day_of_week: dayOfWeek,
          object_ids: Array.from(selected),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setSavedIds(Array.from(selected));
      setDefaultsUpdatedAt(new Date().toISOString());
      toast.success(`Auswahl für ${WEEKDAY_NAMES[dayOfWeek]} gespeichert.`);
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function handleOptimize() {
    if (selected.size === 0) return;
    setOptimizing(true);
    try {
      const res = await fetch("/api/planning/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_ids: Array.from(selected),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Routenberechnung fehlgeschlagen.");
        return;
      }
      setRoute(body as RouteOptimizationResult);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if ((body as RouteOptimizationResult).warnings.length > 0) {
        toast.info("Route berechnet – bitte Hinweise beachten.");
      } else {
        toast.success("Route optimiert & sortiert.");
      }
    } catch {
      toast.error("Routenberechnung fehlgeschlagen.");
    } finally {
      setOptimizing(false);
    }
  }

  function handleApplyPhoto(matches: PhotoMatch[]) {
    setSelected(new Set(matches.map((m) => m.object_id)));
    toast.success(
      `${matches.length} Objekt${matches.length === 1 ? "" : "e"} aus dem Foto übernommen.`,
    );
  }

  async function handleStartTour() {
    if (!route) return;
    setStartingTour(true);
    try {
      // Tatsächliche Startzeit: die aktuelle Uhrzeit beim Drücken des Buttons
      // (nicht die geschätzte Abfahrtszeit aus der Routenberechnung).
      const now = new Date();
      const actualStart = formatMinutes(now.getHours() * 60 + now.getMinutes());
      // Alle Ankunftszeiten um die Differenz zur geschätzten Abfahrtszeit
      // verschieben, damit das Auslieferungsfenster dem echten Start entspricht.
      const delta = toMinutes(actualStart) - toMinutes(route.departure_time);

      const res = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: actualStart,
          status: "in_transit",
          stops: route.stops.map((stop) => ({
            object_id: stop.object_id,
            arrival_time: formatMinutes(toMinutes(stop.arrival) + delta),
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Tour konnte nicht gestartet werden.");
        return;
      }
      toast.success("Tour gestartet – los geht's!");
      router.push(`/tour/${body.tour.id}`);
    } catch {
      toast.error("Tour konnte nicht gestartet werden.");
    } finally {
      setStartingTour(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.address.toLowerCase().includes(q),
    );
  }, [objects, search]);

  const objectsGroup = filtered.filter((o) => o.category === "objekt");
  const treppenhausGroup = filtered.filter((o) => o.category === "treppenhaus");

  const renderRow = (obj: PlanningObject) => {
    const isSelected = selected.has(obj.id);
    return (
      <li key={obj.id}>
        <label
          className={[
            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
            isSelected
              ? "border-primary/50 bg-primary/5"
              : "border-transparent bg-card hover:border-border hover:bg-accent/40",
          ].join(" ")}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={(v) => toggle(obj.id, v === true)}
            aria-label={`${obj.name} auswählen`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{obj.name}</span>
              {obj.is_pedestrian_zone_until_11 && (
                <Badge variant="warning">vor 11:00</Badge>
              )}
              {obj.opens_at && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  ab {obj.opens_at.slice(0, 5)}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {obj.address}
            </span>
          </span>
          <Check
            className={[
              "h-5 w-5 shrink-0 transition-opacity",
              isSelected ? "text-primary opacity-100" : "opacity-0",
            ].join(" ")}
          />
        </label>
      </li>
    );
  };

  const renderGroup = (title: string, items: PlanningObject[]) =>
    items.length > 0 ? (
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} ({items.length})
        </h2>
        <ul className="space-y-1.5">{items.map(renderRow)}</ul>
      </section>
    ) : null;

  const openPackDialog = (stop: OptimizedStop) =>
    setPackDialog({
      open: true,
      objectId: stop.object_id,
      objectName: stop.name,
    });

  return (
    <div className="container pb-28 pt-6 sm:pt-10">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {route ? "Pack-Modus" : "Tourenplanung"}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {route
              ? "Prüfe die Packlisten und starte die Ausfahrt, wenn alles verstaut ist."
              : `Wähle die Objekte für deine Tour. Die Auswahl wird gespeichert und am nächsten ${WEEKDAY_NAMES[dayOfWeek]} automatisch vorgeschlagen.`}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
            <CalendarDays className="h-4 w-4 text-primary" />
            {todayLabel}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!route && (
            <>
              <Button
                variant="outline"
                onClick={() => setPhotoOpen(true)}
                disabled={loading}
              >
                <Camera />
                Foto-Auswahl
              </Button>
              <Button
                onClick={() => void handleOptimize()}
                disabled={selected.size === 0 || optimizing || loading}
              >
                {optimizing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    Route wird berechnet…
                  </>
                ) : (
                  <>
                    <Route />
                    Route berechnen & sortieren
                  </>
                )}
              </Button>
            </>
          )}
          {route && (
            <Button
              variant="outline"
              onClick={() => setRoute(null)}
              disabled={startingTour}
            >
              <ArrowLeft />
              Zurück zur Auswahl
            </Button>
          )}
        </div>
      </div>

      {/* Vorauswahl-Hinweis (nur im Auswahl-Modus) */}
      {!route && !loading && !error && (
        <div className="mt-4">
          {defaultsUpdatedAt ? (
            <div className="flex items-start gap-2 rounded-md border bg-primary/5 px-3 py-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Vorauswahl vom letzten {WEEKDAY_NAMES[dayOfWeek]} übernommen
                (zuletzt gespeichert am{" "}
                {shortDateFormatter.format(new Date(defaultsUpdatedAt))}).
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              Keine gespeicherte Vorauswahl für {WEEKDAY_NAMES[dayOfWeek]} –
              wähle unten die Objekte aus und speichere die Auswahl.
            </div>
          )}
        </div>
      )}

      {/* Suche (nur im Auswahl-Modus) */}
      {!route && !loading && !error && objects.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Objekte suchen…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set(objects.map((o) => o.id)))}
            >
              Alle auswählen
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Auswahl leeren
            </Button>
          </div>
        </div>
      )}

      {/* Inhalt */}
      <div className="mt-4">
        {error?.code === "SUPABASE_NOT_CONFIGURED" ? (
          <SetupHint message={error.message} />
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
            {error.message}
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : route ? (
          <PackView
            route={route}
            onOpenStop={openPackDialog}
          />
        ) : objects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Store className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold">
              Noch keine Objekte angelegt
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Lege zuerst Objekte in der Objektverwaltung an, dann kannst du
              hier deine Tour zusammenstellen.
            </p>
            <Link
              href="/objects"
              className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              Zur Objektverwaltung
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Keine Objekte gefunden, die zu „{search}“ passen.
          </div>
        ) : (
          <div className="space-y-6">
            {renderGroup("Objekte", objectsGroup)}
            {renderGroup("Treppenhäuser", treppenhausGroup)}
          </div>
        )}
      </div>

      {/* Dialoge */}
      <PhotoSelectDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        onApply={handleApplyPhoto}
      />
      <PackDialog
        open={packDialog.open}
        objectId={packDialog.objectId}
        objectName={packDialog.objectName}
        onOpenChange={(open) =>
          setPackDialog((prev) => ({ ...prev, open }))
        }
      />

      {/* Sticky-Leiste */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container flex h-16 items-center justify-between gap-3">
          {route ? (
            <>
              <p className="min-w-0 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {route.stops.length}
                </span>{" "}
                Stopps · Start {route.start_time} Uhr
              </p>
              <Button
                size="lg"
                onClick={() => void handleStartTour()}
                disabled={startingTour}
                className="gap-2"
              >
                <Play />
                {startingTour ? "Tour wird gestartet…" : "Ausfahren beginnen"}
              </Button>
            </>
          ) : (
            <>
              <p className="min-w-0 text-sm">
                <span className="font-semibold">{selected.size}</span>{" "}
                Objekt{selected.size === 1 ? "" : "e"} ausgewählt
              </p>
              <Button onClick={() => void handleSave()} disabled={!dirty || saving}>
                <Save />
                {saving ? "Wird gespeichert…" : "Auswahl speichern"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
