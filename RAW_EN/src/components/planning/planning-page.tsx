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
import { ListStatus } from "@/components/list-status";
import { offlineFetch } from "@/lib/offline/fetch";
import { loadList } from "@/lib/offline/list";
import { nowServerAligned } from "@/lib/offline/clock";
import { useItemList } from "@/lib/use-item-list";
import { getCurrentUserId } from "@/lib/offline/sync";
import { newUuid } from "@/lib/offline/db";
import type {
  ApiError,
  OptimizedStop,
  PhotoMatch,
  PlanningObject,
  RouteOptimizationResult,
  TourHistoryItem,
  UnknownTarget,
} from "@/types/api";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
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
      typeof parsed.route.mode !== "string" ||
      // Zeitfelder werden beim Rendern (PackView) und Tourstart mathematisch
      // benutzt – ohne sie würde ein alter/defekter Entwurf die Seite crashen.
      typeof parsed.route.start_time !== "string" ||
      typeof parsed.route.departure_time !== "string" ||
      typeof parsed.route.warehouse_arrival !== "string"
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


  // Nur aktuelle Daten: die Objektliste kommt vom Server, der Offline-Cache
  // ist reiner Fallback (mit Zeitstempel). Beim Laden dreht ein Spinner.
  const list = useItemList<PlanningObject[]>(
    "/api/planning",
    (body) => (body.objects ?? []) as PlanningObject[],
    "planning",
  );
  const objects = list.data ?? [];
  const [unknownTargets, setUnknownTargets] = useState<UnknownTarget[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedUnknown, setSelectedUnknown] = useState<Set<string>>(new Set());
  const [selectedKeyStopIds, setSelectedKeyStopIds] = useState<Set<string>>(new Set());
  const loading = list.loading;
  const error = list.error;
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
  // Active tour (packing oder in_transit) – damit der Fahrer seine Tour
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
  const [clockingIn, setClockingIn] = useState(false);

  const todayLabel = useMemo(() => dateFormatter.format(new Date()), []);

  useEffect(() => {
    const targets = loadUnknownTargets();
    setUnknownTargets(targets);
    setSelectedUnknown(new Set(targets.map((target) => target.id)));
  }, []);

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

  // Laufende Tour laden (nur eigene Touren). Nur Touren von HEUTE mit Status
  // packing/in_transit gelten als „laufend“. Server zuerst, Cache als Fallback.
  const loadActiveTour = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const isActive = (t: TourHistoryItem) =>
      (t.status === "in_transit" || t.status === "packing") &&
      t.date === today;
    const result = await loadList(
      "/api/tours",
      (body) => (body.tours ?? []) as TourHistoryItem[],
    );
    // Offline ohne Cache: kein Banner – die Planung selbst funktioniert weiter.
    const active = (result.data ?? []).find(isActive);
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
      // newUuid statt crypto.randomUUID: Letzteres existiert nur in sicheren
      // Kontexten (HTTPS/localhost) – sonst würde „Unknown destination“ crashen.
      id: newUuid(),
      name: `Unknown destination ${unknownTargets.length + 1}`,
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
        toast.error(body.error ?? "Route calculation failed.");
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
        toast.info("Route calculated – please note the hints.");
      } else {
        toast.success("Route optimised & sorted.");
      }
      // Pack-Modus lokal zwischenspeichern: „Ausfahren beginnen“ legt die
      // echte Tour erst beim Start an (status „in_transit“).
      savePackDraft(routeWithKeys);
    } catch {
      toast.error("Route calculation failed.");
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
    // nicht der Fall, muss der Nutzer erst bestätigen (direkt einstempeln oder
    // ohne Einstempeln fortfahren).
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

  // „Erst einstempeln“: direkt aus dem Dialog heraus einstempeln (ohne
  // Seitenwechsel – die Planungsseite würde sonst neu geladen, die Auswahl
  // verloren gehen und die Routenberechnung abbrechen). Danach die
  // Berechnung normal fortsetzen.
  async function handleClockInAndContinue() {
    if (clockingIn) return;
    setClockingIn(true);
    try {
      const eventAt = nowServerAligned();
      const res = await offlineFetch("/api/time-tracking/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clock_in",
          event_at: eventAt,
          client_updated_at: eventAt,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Clock-in failed.");
        // Dialog bleibt offen: erneut versuchen oder ohne Einstempeln fortfahren.
        return;
      }
      toast.success("Work time started.");
      // Stempeluhr-Widget (Header/Mobile-Leiste) sofort aktualisieren.
      window.dispatchEvent(new Event("app-clock-refresh"));
      setClockWarningOpen(false);
      await runOptimize();
    } catch {
      toast.error("Clock-in failed.");
    } finally {
      setClockingIn(false);
    }
  }

  function handleApplyPhoto(matches: PhotoMatch[]) {
    setSelected(new Set(matches.map((m) => m.object_id)));
    toast.success(
      `${matches.length} object${matches.length === 1 ? "" : "s"} imported from the photo.`,
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
        toast.error(body.error ?? "Could not start the tour.");
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
      toast.success("Tour started – off we go!");
      router.push(`/tour/${body.tour.id}`);
    } catch {
      toast.error("Could not start the tour.");
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
        toast.error(body.error ?? "Could not delete the tour.");
        return;
      }
      toast.success("Active tour deleted.");
      setActiveTour(null);
      setDeleteTarget(null);
    } catch {
      toast.error("Could not delete the tour.");
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
            aria-label={`${obj.name} to select`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{obj.name}</span>
              {obj.is_pedestrian_zone_until_11 && (
                <Badge variant="warning">Pedestrian zone</Badge>
              )}
              {obj.opens_at && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  from {obj.opens_at.slice(0, 5)}
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
      <ListStatus
        refreshing={list.refreshing}
        offlineSince={list.offlineSince}
        className="mb-3"
      />

      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {route ? "Pack mode" : "Tour planning"}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {route
              ? "Check the packing lists and start the trip once everything is loaded. Your progress is saved automatically – you can continue here later."
              : "Select the objects for your tour, then calculate the optimal route."}
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
                  Calculating route…
                </>
              ) : (
                <>
                  <Route />
                  Calculate & sort route
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
              Back to selection
            </Button>
          )}
        </div>
      </div>

      {/* Active tour: direkter Einstieg, auch nach Tab-/App-Neustart.
          Nur Touren by heute (ältere löscht der Server automatisch). */}
      {activeTour && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Truck className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Active tour</p>
              <p className="truncate text-xs text-muted-foreground">
                {new Date(
                  activeTour.date + "T00:00:00",
                ).toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
                {activeTour.start_time
                  ? ` · Start ${activeTour.start_time.slice(0, 5)}`
                  : ""}
                {" "}–
                {activeTour.status === "packing"
                  ? "  pack and then start"
                  : " continue and complete"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete active tour"
              onClick={() =>
                setDeleteTarget({ id: activeTour.id, date: activeTour.date })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="sm" asChild>
              <Link href={`/tour/${activeTour.id}`} className="gap-1.5">
                <Play className="h-4 w-4" />
                Open tour
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* Suche + Photo import (nur im Auswahl-Modus) */}
      {!route && !loading && !error && objects.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search objects…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm font-semibold tabular-nums"
              aria-label={`${selected.size}/${objects.length} objects selected`}
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
              Photo import
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
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
                Unknown destination
              </Button>
            </div>
            {unknownTargets.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Unknown destinations ({unknownTargets.length})
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
                            aria-label={`${target.name} to select`}
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
                            <span className="block font-medium">{target.name || `Unknown destination ${index + 1}`}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {cleanAddressLabel(target.address) || "Address missing"}
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground"
                            aria-label={`Edit ${target.name}`}
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
                  No objects created yet
                </h2>
                <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-sm">
                  Create objects in the object management first, then you can build your tour here.
                </p>
                <Link
                  href="/objects"
                  className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
                >
                  Go to object management
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                No objects match “{search}”.
              </div>
            ) : (
              <div className="space-y-6">
                {renderGroup("Objects", objectsGroup)}
                {renderGroup("Stairwells", treppenhausGroup)}
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

      {/* Delete active tour (Bestätigung) */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete active tour?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  Die Tour of{" "}
                  <strong>
                    {new Date(
                      deleteTarget.date + "T00:00:00",
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>{" "}
                  is deleted together with its stops. Afterwards you can
                  calculate a new route.
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
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteActiveTour()}
              disabled={deleting}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting…" : "Delete"}
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
              Not clocked in yet
            </DialogTitle>
            <DialogDescription>
              You have not started any work time today. For this tour no work time will be recorded. Do you want to clock in first, or continue without clocking in?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => void handleClockInAndContinue()}
              disabled={clockingIn}
            >
              <Play className="h-4 w-4" />
              {clockingIn ? "Clocking in…" : "Clock in first"}
            </Button>
            <Button
              variant="outline"
              onClick={handleContinueWithoutClockIn}
              disabled={clockingIn}
            >
              Continue without clocking in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sticky-Leiste: nur im Pack-Modus nötig (Auswahl-Modus hat ihre
          Aktion oben). Auf dem Handy über der festen Stempeluhr-Leiste
          (bottom-14), on Desktop on unteren Rand. */}
      {route && (
        <div className="fixed inset-x-0 bottom-14 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:bottom-0">
          <div className="container flex h-16 items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {route.stops.length}
              </span>{" "}
              stops · Start {route.start_time}
            </p>
            <Button
              size="lg"
              onClick={() => void handleStartTour()}
              disabled={startingTour || optimizing}
              className="gap-2"
            >
              <Play />
              {startingTour ? "Starting tour…" : "Start the tour"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
