"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  Clock,
  MapPin,
  MessageSquareText,
  Play,
  Route,
  Search,
  Store,
  Trash2,
  Truck,
  KeyRound,
  Pencil,
  Plus,
} from "lucide-react";
import { cleanAddressLabel } from "@/lib/address";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SetupHint } from "@/components/setup-hint";
import { PhotoSelectDialog } from "./photo-select-dialog";
import { PackView } from "./pack-view";
import { PackDialog } from "./pack-dialog";
import { KeySelectionDialog } from "./key-selection-dialog";
import { UnknownTargetDialog } from "./unknown-target-dialog";
import {
  defaultStartTime,
  formatMinutes,
  prepMinutesForCount,
  toMinutes,
} from "@/lib/routing/time";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
import { endListPerf, markFirstData, startListPerf } from "@/lib/perf";
import { getCurrentUserId } from "@/lib/offline/sync";
import type {
  ApiError,
  OptimizedStop,
  PhotoMatch,
  PlanningObject,
  RouteOptimizationResult,
  TourHistoryItem,
  UnknownTarget,
} from "@/types/api";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Session-Speicher: Ein Tab-Wechsel innerhalb der App erhält den Pack-Modus,
// ein Schließen/Neustart der App verwirft Route und unbekannte Ziele.
const PACK_DRAFT_KEY = "planning-pack-draft";
const UNKNOWN_TARGETS_KEY = "planning-unknown-targets";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** localStorage-Schlüssel für den aktuellen Nutzer (null, wenn unbekannt). */
function sessionKey(base: string): string | null {
  const userId = getCurrentUserId();
  return userId ? `${base}:${userId}` : null;
}

function packDraftKey(): string | null {
  return sessionKey(PACK_DRAFT_KEY);
}

function unknownTargetsKey(): string | null {
  return sessionKey(UNKNOWN_TARGETS_KEY);
}

function savePackDraft(route: RouteOptimizationResult) {
  const key = packDraftKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ date: todayUtc(), route }));
  } catch {
    // Speicher blockiert/überfüllt – der Pack-Modus funktioniert trotzdem.
  }
}

function loadPackDraft(): RouteOptimizationResult | null {
  const key = packDraftKey();
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      date?: unknown;
      route?: Partial<RouteOptimizationResult>;
    };
    // Veraltete Entwürfe (anderer Tag) sofort aufräumen.
    if (parsed.date !== todayUtc()) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (
      !parsed.route ||
      !Array.isArray(parsed.route.stops) ||
      !Array.isArray(parsed.route.warnings) ||
      typeof parsed.route.mode !== "string"
    ) {
      return null;
    }
    return parsed.route as RouteOptimizationResult;
  } catch {
    return null;
  }
}

function clearPackDraft() {
  const key = packDraftKey();
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignorieren
  }
}  function loadUnknownTargets(): UnknownTarget[] {
  const key = unknownTargetsKey();
  if (!key) return [];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (target): target is UnknownTarget =>
        Boolean(
          target &&
            typeof target === "object" &&
            typeof (target as UnknownTarget).id === "string" &&
            typeof (target as UnknownTarget).name === "string" &&
            typeof (target as UnknownTarget).address === "string",
        ),
    ).map((target) => ({
      ...target,
      latitude:
        typeof target.latitude === "number" ? target.latitude : null,
      longitude:
        typeof target.longitude === "number" ? target.longitude : null,
    }));
  } catch {
    return [];
  }
}

function saveUnknownTargets(targets: UnknownTarget[]) {
  const key = unknownTargetsKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(targets));
  } catch {
    // Speicher blockiert/überfüllt – die aktuelle Auswahl funktioniert trotzdem.
  }
}

export function PlanningPage() {
  const router = useRouter();


  const [objects, setObjects] = useState<PlanningObject[]>([]);
  const [unknownTargets, setUnknownTargets] = useState<UnknownTarget[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedUnknown, setSelectedUnknown] = useState<Set<string>>(new Set());
  const [selectedKeyStopIds, setSelectedKeyStopIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState("");

  // Routen-Optimierung / Pack-Modus
  const [optimizing, setOptimizing] = useState(false);
  const [route, setRoute] = useState<RouteOptimizationResult | null>(null);
  const [packDialog, setPackDialog] = useState<{
    open: boolean;
    objectId: string | null;
    objectName: string | null;
  }>({ open: false, objectId: null, objectName: null });
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [unknownDialog, setUnknownDialog] = useState<{
    open: boolean;
    target: UnknownTarget | null;
  }>({ open: false, target: null });
  const [startingTour, setStartingTour] = useState(false);
  // Laufende Tour (packing oder in_transit) – damit der Fahrer seine Tour
  // auch nach Tab-/App-Neustart sofort wiederfindet. Nur Touren von HEUTE
  // zählen (ältere werden vom Server automatisch gelöscht).
  const [activeTour, setActiveTour] = useState<
    | {
        id: string;
        date: string;
        start_time: string | null;
        status: "packing" | "in_transit";
      }
    | null
  >(null);
  // Löschen der laufenden Tour aus dem Banner (Bestätigungsdialog).
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    date: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Warnung „noch nicht eingestempelt“ vor der Routenberechnung
  const [clockWarningOpen, setClockWarningOpen] = useState(false);
  const [checkingClock, setCheckingClock] = useState(false);

  const todayLabel = useMemo(() => dateFormatter.format(new Date()), []);

  // Stale-while-revalidate: gecachte Planung sofort anzeigen, frische Daten
  // parallel vom Server nachladen.
  const load = useCallback(async (fresh = false) => {
    setError(null);
    const url = "/api/planning";
    startListPerf("planning");
    const cached = fresh ? null : await offlineReadCached(url);
    if (cached) {
      markFirstData("planning", "cache", ((cached.objects as PlanningObject[]) ?? []).length);
      setObjects((cached.objects as PlanningObject[]) ?? []);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await offlineFetch(url, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        // Bereits sichtbare Cache-Daten nicht durch eine Fehlermeldung ersetzen.
        if (!cached) {
          setError({ code: body.code, message: body.error ?? "Unbekannter Fehler" });
        }
        return;
      }
      setObjects(body.objects ?? []);
      endListPerf("planning", { source: "network", count: (body.objects ?? []).length });
    } catch {
      if (!cached) {
        setError({ message: "Netzwerkfehler beim Laden der Tourenplanung." });
      }
      endListPerf("planning", { source: "offline", count: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const targets = loadUnknownTargets();
    setUnknownTargets(targets);
    setSelectedUnknown(new Set(targets.map((target) => target.id)));
  }, [load]);

  useEffect(() => {
    saveUnknownTargets(unknownTargets);
  }, [unknownTargets]);

  // Berechnete Route aus dem lokalen Zwischenspeicher wiederherstellen
  // (gleicher Tag), damit der Wechsel zu Einstellungen/Inventar und zurück
  // den Pack-Modus nicht verwirft.
  useEffect(() => {
    const draft = loadPackDraft();
    if (draft) {
      setRoute(draft);
      setSelectedKeyStopIds(
        new Set(
          draft.selected_key_stop_ids ??
            draft.stops
              .filter((stop) => !stop.is_unknown && stop.key_number != null)
              .map((stop) => stop.object_id),
        ),
      );
    }
  }, []);

  // Laufende Tour laden (nur eigene Touren, stale-while-revalidate). Nur
  // Touren von HEUTE mit Status packing/in_transit gelten als „laufend“.
  const loadActiveTour = useCallback(async () => {
    const url = "/api/tours";
    const today = new Date().toISOString().slice(0, 10);
    const isActive = (t: TourHistoryItem) =>
      (t.status === "in_transit" || t.status === "packing") &&
      t.date === today;
    const cached = await offlineReadCached(url);
    const cachedTours = (cached?.tours ?? []) as TourHistoryItem[];
    const cachedActive = cachedTours.find(isActive);
    if (cachedActive) {
      setActiveTour({
        id: cachedActive.id,
        date: cachedActive.date,
        start_time: cachedActive.start_time,
        status:
          cachedActive.status === "in_transit" ? "in_transit" : "packing",
      });
    }
    try {
      const res = await offlineFetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      const active = (body.tours ?? []).find(isActive);
      setActiveTour(
        active
          ? {
              id: active.id,
              date: active.date,
              start_time: active.start_time,
              status: active.status === "in_transit" ? "in_transit" : "packing",
            }
          : null,
      );
    } catch {
      // Offline ohne Cache: kein Banner – die Planung selbst funktioniert weiter.
    }
  }, []);

  useEffect(() => {
    void loadActiveTour();
  }, [loadActiveTour]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleUnknown(id: string, checked: boolean) {
    setSelectedUnknown((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function addUnknownTarget() {
    const target: UnknownTarget = {
      id: crypto.randomUUID(),
      name: `Unbekanntes Ziel ${unknownTargets.length + 1}`,
      address: "",
      latitude: null,
      longitude: null,
    };
    setUnknownTargets((prev) => [...prev, target]);
    setSelectedUnknown((prev) => new Set(prev).add(target.id));
    setUnknownDialog({ open: true, target });
  }

  function updateUnknownTarget(
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) {
    const target = unknownDialog.target;
    if (!target) return;
    setUnknownTargets((prev) =>
      prev.map((item) =>
        item.id === target.id ? { ...item, address, latitude, longitude } : item,
      ),
    );
  }
  function deleteUnknownTarget(targetId: string) {
    setUnknownTargets((prev) => prev.filter((target) => target.id !== targetId));
    setSelectedUnknown((prev) => {
      const next = new Set(prev);
      next.delete(targetId);
      return next;
    });
    setUnknownDialog({ open: false, target: null });
  }

  async function runOptimize() {
    const selectedTargets = unknownTargets.filter((target) =>
      selectedUnknown.has(target.id),
    );
    if (selected.size === 0 && selectedTargets.length === 0) return;
    setOptimizing(true);
    try {
      const res = await offlineFetch("/api/planning/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_ids: Array.from(selected),
          unknown_targets: selectedTargets,
          // Startzeit im Browser (Gerätezeit) berechnen: aktuelle Uhrzeit +
          // Vorbereitungszeit (4 Min/Stopp + 5 Min Schlüssel), auf 5 Min
          // gerundet. Der Server rechnet sonst in seiner Zeitzone (UTC) –
          // die Startzeit läge dann z. B. im Sommer ~2 Std. in der
          // Vergangenheit (siehe Fehlerbericht).
          start_time: defaultStartTime(
            prepMinutesForCount(selected.size + selectedTargets.length),
          ),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Routenberechnung fehlgeschlagen.");
        return;
      }
      const routeBody = body as RouteOptimizationResult;
      // Fallback-Koordinaten aus der Planungsauswahl einsetzen: Stopps ohne
      // Koordinaten (Demo-Modus/Geocoding-Fallback) bekommen die verifizierten
      // DB-Koordinaten der Objektliste – sonst fehlen sie später auf der
      // Pack-/Tour-Karte, während die Liste sie normal anzeigt.
      const coordByObjectId = new Map(
        objects.map((o) => [o.id, { latitude: o.latitude ?? null, longitude: o.longitude ?? null }]),
      );
      const stopsWithCoords = routeBody.stops.map((stop) => {
        if (stop.is_unknown) return stop;
        if (typeof stop.latitude === "number" && typeof stop.longitude === "number") return stop;
        const fallback = coordByObjectId.get(stop.object_id);
        if (
          fallback &&
          typeof fallback.latitude === "number" &&
          typeof fallback.longitude === "number"
        ) {
          return { ...stop, latitude: fallback.latitude, longitude: fallback.longitude };
        }
        return stop;
      });
      const initialKeys = new Set(
        routeBody.stops
          .filter((stop) => !stop.is_unknown && stop.key_number != null)
          .map((stop) => stop.object_id),
      );
      const routeWithKeys = {
        ...routeBody,
        stops: stopsWithCoords,
        selected_key_stop_ids: [...initialKeys],
        key_selection_confirmed: false,
      } as RouteOptimizationResult;
      setSelectedKeyStopIds(initialKeys);
      // Nicht ausgewählte unbekannte Ziele gehören nicht zur neu berechneten
      // Tour und werden deshalb aus dem temporären Entwurf entfernt.
      setUnknownTargets(selectedTargets);
      setSelectedUnknown(new Set(selectedTargets.map((target) => target.id)));
      setRoute(routeWithKeys);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (routeBody.warnings.length > 0) {
        toast.info("Route berechnet – bitte Hinweise beachten.");
      } else {
        toast.success("Route optimiert & sortiert.");
      }
      // Pack-Modus lokal zwischenspeichern: „Ausfahren beginnen“ legt die
      // echte Tour erst beim Start an (status „in_transit“).
      savePackDraft(routeWithKeys);
    } catch {
      toast.error("Routenberechnung fehlgeschlagen.");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleOptimize() {
    if (
      (selected.size === 0 && selectedUnknown.size === 0) ||
      optimizing ||
      checkingClock
    ) return;
    // Vor der Routenberechnung prüfen, ob bereits eingestempelt ist. Ist das
    // nicht der Fall, muss der Nutzer erst bestätigen (weiter ohne Einstempeln
    // oder erst zur Hauptseite zum Einstempeln).
    setCheckingClock(true);
    try {
      const res = await offlineFetch("/api/time-tracking/clock", {
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!body.entry) {
          setClockWarningOpen(true);
          return;
        }
      }
    } catch {
      // Clock-Status nicht ermittelbar (z. B. offline ohne Cache) – nicht blockieren.
    } finally {
      setCheckingClock(false);
    }
    await runOptimize();
  }

  function handleContinueWithoutClockIn() {
    setClockWarningOpen(false);
    void runOptimize();
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

      // „Ausfahren beginnen“ legt die Tour direkt an (status „in_transit“).
      // Der Server ersetzt dabei automatisch eine alte laufende Tour.
      const delta = toMinutes(actualStart) - toMinutes(route.departure_time);
      const res = await offlineFetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: actualStart,
          status: "in_transit",
          // Geplante Rückkehr im Lager analog zu den Stopps an den
          // tatsächlichen Start anpassen.
          warehouse_arrival: formatMinutes(
            toMinutes(route.warehouse_arrival) + delta,
          ),
          stops: route.stops.map((stop) => {
            // Unbekannte Ziele: die verifizierten Koordinaten aus dem lokalen
            // Ziel-Entwurf (Adress-Auswahl) als Stop-Snapshot speichern –
            // sonst fehlt das Ziel später auf der Tour-Karte. Fallback: die
            // Koordinaten, mit denen die Route berechnet wurde.
            const target = stop.is_unknown
              ? unknownTargets.find((t) => t.id === stop.unknown_target_id)
              : undefined;
            return {
              object_id: stop.is_unknown ? null : stop.object_id,
              key_number:
                !stop.is_unknown && selectedKeyStopIds.has(stop.object_id)
                  ? stop.key_number ?? null
                  : null,
              arrival_time: formatMinutes(toMinutes(stop.arrival) + delta),
              is_unknown: stop.is_unknown,
              unknown_target_id: stop.unknown_target_id,
              unknown_name: stop.unknown_name,
              unknown_address: stop.unknown_address,
              unknown_latitude:
                target?.latitude ?? (stop.is_unknown ? stop.latitude : null),
              unknown_longitude:
                target?.longitude ?? (stop.is_unknown ? stop.longitude : null),
            };
          }),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Tour konnte nicht gestartet werden.");
        return;
      }
      clearPackDraft();
      try {
        sessionStorage.removeItem(unknownTargetsKey() ?? "");
      } catch {
        // ignorieren
      }
      setUnknownTargets([]);
      setSelectedUnknown(new Set());
      toast.success("Tour gestartet – los geht's!");
      router.push(`/tour/${body.tour.id}`);
    } catch {
      toast.error("Tour konnte nicht gestartet werden.");
    } finally {
      setStartingTour(false);
    }
  }

  async function handleDeleteActiveTour() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await offlineFetch(`/api/tours/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Tour konnte nicht gelöscht werden.");
        return;
      }
      toast.success("Laufende Tour gelöscht.");
      setActiveTour(null);
      setDeleteTarget(null);
    } catch {
      toast.error("Tour konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
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
                <Badge variant="warning">Fußgängerzone</Badge>
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
              {cleanAddressLabel(obj.address)}
            </span>
            {obj.remark && (
              <span
                className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground/80"
                title={obj.remark}
              >
                <MessageSquareText className="h-3 w-3 shrink-0" />
                <span className="truncate">{obj.remark}</span>
              </span>
            )}
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

  const openPackDialog = (stop: OptimizedStop) => {
    if (stop.is_unknown) return;
    setPackDialog({
      open: true,
      objectId: stop.object_id,
      objectName: stop.name,
    });
  };

  return (
    <div className="container pb-44 pt-6 sm:pb-28 sm:pt-10">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {route ? "Pack-Modus" : "Tourenplanung"}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {route
              ? "Prüfe die Packlisten und starte die Ausfahrt, wenn alles verstaut ist. Dein Zwischenstand wird automatisch gespeichert – du kannst später hier weitermachen."
              : "Wähle die Objekte für deine Tour und berechne dann die optimale Route."}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
            <CalendarDays className="h-4 w-4 text-primary" />
            {todayLabel}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!route && (
            <Button
              onClick={() => void handleOptimize()}
              disabled={(selected.size === 0 && selectedUnknown.size === 0) || optimizing || checkingClock || loading}
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
          )}
          {route && (
            <Button
              variant="outline"
              onClick={() => {
                clearPackDraft();
                setRoute(null);
              }}
              disabled={startingTour}
            >
              <ArrowLeft />
              Zurück zur Auswahl
            </Button>
          )}
        </div>
      </div>

      {/* Laufende Tour: direkter Einstieg, auch nach Tab-/App-Neustart.
          Nur Touren von heute (ältere löscht der Server automatisch). */}
      {activeTour && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Truck className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Laufende Tour</p>
              <p className="truncate text-xs text-muted-foreground">
                {new Date(
                  activeTour.date + "T00:00:00",
                ).toLocaleDateString("de-DE", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
                {activeTour.start_time
                  ? ` · Start ${activeTour.start_time.slice(0, 5)} Uhr`
                  : ""}
                {" "}–
                {activeTour.status === "packing"
                  ? " packen und dann starten"
                  : " weiterfahren und abschließen"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Laufende Tour löschen"
              onClick={() =>
                setDeleteTarget({ id: activeTour.id, date: activeTour.date })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="sm" asChild>
              <Link href={`/tour/${activeTour.id}`} className="gap-1.5">
                <Play className="h-4 w-4" />
                Zur Tour
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* Suche + Foto-Auswahl (nur im Auswahl-Modus) */}
      {!route && !loading && !error && objects.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Objekte suchen…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm font-semibold tabular-nums"
              aria-label={`${selected.size}/${objects.length} Objekte ausgewählt`}
            >
              {selected.size}/{objects.length}
            </span>
            <Button
              variant="outline"
              onClick={() => setPhotoOpen(true)}
              disabled={loading}
              className="gap-1.5"
            >
              <Camera />
              Foto-Auswahl
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
            selectedKeyStopIds={selectedKeyStopIds}
            onOpenStop={openPackDialog}
            onOpenKeys={() => setKeyDialogOpen(true)}
          />
        ) : (
          <div className="space-y-6">
            {/* Einziger Button zum Anlegen unbekannter Ziele (auch bei
                leerer Liste sichtbar); die Überschrift verschwindet, wenn
                es keine unbekannten Ziele gibt. */}
            <div className="flex justify-end">
              <Button variant="outline" onClick={addUnknownTarget} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Unbekanntes Ziel
              </Button>
            </div>
            {unknownTargets.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Unbekannte Ziele ({unknownTargets.length})
                </h2>
                <ul className="space-y-1.5">
                  {unknownTargets.map((target, index) => {
                    const isSelected = selectedUnknown.has(target.id);
                    return (
                      <li key={target.id}>
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
                            onCheckedChange={(value) => toggleUnknown(target.id, value === true)}
                            aria-label={`${target.name} auswählen`}
                          />
                          {/* Antippen der Zeile wählt ab/aus (wie bei den
                              Objekt-Zielen); der Stift-Button öffnet den
                              Dialog zum Bearbeiten der Adresse. */}
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={(event) => {
                              event.preventDefault();
                              toggleUnknown(target.id, !isSelected);
                            }}
                          >
                            <span className="block font-medium">{target.name || `Unbekanntes Ziel ${index + 1}`}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {cleanAddressLabel(target.address) || "Adresse fehlt"}
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground"
                            aria-label={`${target.name} bearbeiten`}
                            onClick={(event) => {
                              event.preventDefault();
                              setUnknownDialog({ open: true, target });
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Check
                            className={[
                              "h-5 w-5 shrink-0 transition-opacity",
                              isSelected ? "text-primary opacity-100" : "opacity-0",
                            ].join(" ")}
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {objects.length === 0 && unknownTargets.length === 0 ? (
              <div className="rounded-lg border border-dashed p-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Store className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-base font-semibold">
                  Noch keine Objekte angelegt
                </h2>
                <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-sm">
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
      <KeySelectionDialog
        open={keyDialogOpen}
        stops={route?.stops ?? []}
        selectedStopIds={selectedKeyStopIds}
        onOpenChange={setKeyDialogOpen}
        onConfirm={(ids) => {
          setSelectedKeyStopIds(ids);
          if (route) {
            const updated = {
              ...route,
              selected_key_stop_ids: [...ids],
              key_selection_confirmed: true,
            };
            setRoute(updated);
            savePackDraft(updated);
          }
        }}
      />
      <UnknownTargetDialog
        open={unknownDialog.open}
        target={unknownDialog.target}
        onOpenChange={(open) =>
          setUnknownDialog((prev) => ({ ...prev, open }))
        }
        onSave={({ address, latitude, longitude }) => {
          updateUnknownTarget(address, latitude, longitude);
        }}
        onDelete={
          unknownDialog.target
            ? () => deleteUnknownTarget(unknownDialog.target!.id)
            : undefined
        }
      />

      {/* Laufende Tour löschen (Bestätigung) */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Laufende Tour löschen?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  Die Tour vom{" "}
                  <strong>
                    {new Date(
                      deleteTarget.date + "T00:00:00",
                    ).toLocaleDateString("de-DE", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>{" "}
                  wird zusammen mit ihren Stopps gelöscht. Danach kannst du eine
                  neue Route berechnen.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteActiveTour()}
              disabled={deleting}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Wird gelöscht…" : "Löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Warnung: nicht eingestempelt, bevor die Route berechnet wird */}
      <Dialog open={clockWarningOpen} onOpenChange={setClockWarningOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              Noch nicht eingestempelt
            </DialogTitle>
            <DialogDescription>
              Du hast heute noch keine Arbeitszeit gestartet. Für die Tour wird
              dann keine Arbeitszeit erfasst. Möchtest du zuerst einstempeln
              oder trotzdem ohne Einstempeln fortfahren?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => router.push("/")}>
              <Play className="h-4 w-4" />
              Erst einstempeln
            </Button>
            <Button variant="outline" onClick={handleContinueWithoutClockIn}>
              Ohne Einstempeln fortfahren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sticky-Leiste: nur im Pack-Modus nötig (Auswahl-Modus hat ihre
          Aktion oben). Auf dem Handy über der festen Stempeluhr-Leiste
          (bottom-14), am Desktop am unteren Rand. */}
      {route && (
        <div className="fixed inset-x-0 bottom-14 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:bottom-0">
          <div className="container flex h-16 items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {route.stops.length}
              </span>{" "}
              Stopps · Start {route.start_time} Uhr
            </p>
            <Button
              size="lg"
              onClick={() => void handleStartTour()}
              disabled={startingTour || optimizing}
              className="gap-2"
            >
              <Play />
              {startingTour ? "Tour wird gestartet…" : "Ausfahren beginnen"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
