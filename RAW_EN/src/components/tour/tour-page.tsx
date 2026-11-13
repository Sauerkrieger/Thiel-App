"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flag,
  MapPin,
  PartyPopper,
  Play,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupHint } from "@/components/setup-hint";
import { ObjectRemark } from "@/components/objects/object-remark";

// Leaflet (Karte) lädt nur im Browser – sonst crasht das Server-Rendering
// mit „window is not defined“ (Leaflet greift beim Modul-Laden auf window zu).
const RouteMap = dynamic(
  () => import("@/components/map/route-map").then((m) => m.RouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 animate-pulse rounded-xl border bg-muted/20 sm:h-80" />
    ),
  },
);
import { cleanAddressLabel } from "@/lib/address";
import { WAREHOUSE_ADDRESS, WAREHOUSE_NAME } from "@/lib/warehouse";
import { formatMinutes } from "@/lib/routing/time";
import { DeliveryDialog } from "./delivery-dialog";
import { NavigateButton } from "./navigate-button";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
import { startTour } from "@/lib/offline/start-tour";
import { endListPerf, markFirstData, startListPerf } from "@/lib/perf";
import type { ApiError, TourStopWithObject, TourWithStops } from "@/types/api";

const STATUS_LABELS: Record<TourWithStops["status"], string> = {
  packing: "Packing",
  in_transit: "In transit",
  completed: "Completed",
};

type Props = { tourId: string };

export function TourPage({ tourId }: Props) {
  const router = useRouter();
  const [tour, setTour] = useState<TourWithStops | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    stop: TourStopWithObject | null;
  }>({ open: false, stop: null });
  const [finishing, setFinishing] = useState(false);
  const [starting, setStarting] = useState(false);

  // Stale-while-revalidate: gecachte Tour sofort anzeigen, frische Daten
  // parallel vom Server nachladen (fresh = nach einer Mutation erzwungen).
  const load = useCallback(async (fresh = false) => {
    setError(null);
    const url = `/api/tours/${tourId}`;
    startListPerf("tour-page");
    const cached = fresh
      ? null
      : await Promise.race([
          offlineReadCached(url),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
    if (cached?.tour) {
      const cachedStops = (cached.tour as TourWithStops).tour_stops ?? [];
      markFirstData("tour-page", "cache", cachedStops.length);
      setTour(cached.tour as TourWithStops);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await offlineFetch(url, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        // Bereits sichtbare Cache-Daten nicht durch eine Fehlermeldung ersetzen.
        if (!cached) {
          setError({ code: body.code, message: body.error ?? "Unknown error" });
        }
        return;
      }
      setTour(body.tour);
      endListPerf("tour-page", {
        source: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "network",
        count: (body.tour?.tour_stops ?? []).length,
      });
    } catch {
      if (!cached) {
        setError({ message: "Network error while loading the tour." });
      }
      endListPerf("tour-page", { source: "offline", count: null });
    } finally {
      setLoading(false);
    }
  }, [tourId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stops = tour?.tour_stops ?? [];
  // Karten-Stopps (stabile Referenz, damit die Karte nicht neu lädt)
  const mapStops = useMemo(
    () =>
      stops.map((stop) => ({
        id: stop.id,
        name: stop.is_unknown
          ? stop.unknown_name ?? "Unknown destination"
          : stop.object?.name ?? "Unknown object",
        latitude: stop.is_unknown
          ? stop.unknown_latitude
          : stop.object?.latitude ?? null,
        longitude: stop.is_unknown
          ? stop.unknown_longitude
          : stop.object?.longitude ?? null,
        delivered: stop.is_delivered,
      })),
    [stops],
  );
  // Hinweis: Die Karte zeigt nur Stopps mit Koordinaten. Vollständigkeit ist
  // sichergestellt durch den Koordinaten-Backfill in GET /api/tours/[id]
  // (Objekte ohne Koordinaten werden beim Laden geocodet + persistiert) –
  // offline greift der Objekt-Cache mit lat/lng.
  const total = stops.length;
  const deliveredCount = stops.filter((stop) => stop.is_delivered).length;
  const undeliverableCount = stops.filter(
    (stop) => stop.is_undeliverable === true,
  ).length;
  // „Abgearbeitet“ = beliefert ODER nicht lieferbar. Erst wenn alle Stopps
  // abgearbeitet sind, darf die Tour completed werden – ohne falsche
  // „beliefert“-Haken für nicht lieferbare Objekte.
  const allDelivered = total > 0 && deliveredCount === total;
  const allResolved = total > 0 && deliveredCount + undeliverableCount === total;
  const openCount = total - deliveredCount - undeliverableCount;
  const progress = total > 0 ? Math.round((deliveredCount / total) * 100) : 0;
  const completed = tour?.status === "completed";

  // Tour aus dem Packmodus starten (status packing → in_transit).
  // Ankunftszeiten werden an den tatsächlichen Start angepasst.
  async function handleStartPackingTour() {
    if (!tour) return;
    setStarting(true);
    try {
      const now = new Date();
      const actualStart = formatMinutes(now.getHours() * 60 + now.getMinutes());
      const result = await startTour({
        tourId: tour.id,
        actualStart,
        plannedStart: tour.start_time ?? actualStart,
        stops: tour.tour_stops.map((stop) => ({
          id: stop.id,
          arrival_time: stop.arrival_time,
        })),
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not start the tour.");
        return;
      }
      toast.success("Tour started – off we go!");
      await load(true);
    } catch {
      toast.error("Could not start the tour.");
    } finally {
      setStarting(false);
    }
  }

  async function handleFinishTour() {
    if (!tour) return;
    setFinishing(true);
    try {
      const res = await offlineFetch(`/api/tours/${tour.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Could not complete the tour.");
        return;
      }
      toast.success("Tour completed – great job!");
      router.push("/objects");
    } catch {
      toast.error("Could not complete the tour.");
    } finally {
      setFinishing(false);
    }
  }

  function openStop(stop: TourStopWithObject) {
    if (stop.is_unknown) return;
    setDialog({ open: true, stop });
  }

  async function deliverUnknownStop(stop: TourStopWithObject) {
    if (!stop.is_unknown || stop.is_delivered || stop.is_undeliverable) return;
    try {
      const res = await offlineFetch(`/api/tours/${tourId}/stops/${stop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_delivered: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Save failed.");
        return;
      }
      toast.success(`„${stop.unknown_name ?? "Unknown destination"}" marked as delivered.`);
      await load(true);
    } catch {
      toast.error("Save failed.");
    }
  }

  return (
    <div className="container pb-44 pt-6 sm:pb-28 sm:pt-10">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tour in transit</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {tour && (
              <>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-4 w-4" />
                  {new Date(tour.date + "T00:00:00").toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                {tour.start_time && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Start {tour.start_time.slice(0, 5)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-4 w-4" />
                  {total} stops
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link href="/planning">
              <ArrowLeft />
              Go to tour planning
            </Link>
          </Button>
          {tour && (
            <Badge
              variant={
                tour.status === "in_transit" ? "success" : "secondary"
              }
              className="w-fit"
            >
              {STATUS_LABELS[tour.status]}
            </Badge>
          )}
        </div>
      </div>

      {/* Inhalt */}
      <div className="mt-6">
        {error?.code === "SUPABASE_NOT_CONFIGURED" ? (
          <SetupHint message={error.message} />
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
            {error.message}
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !tour ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Tour not found.
          </div>
        ) : (          <div className="space-y-4">
            {/* Fortschritt */}
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="font-semibold">{deliveredCount}</span> of{" "}
                  {total} objects delivered
                  {undeliverableCount > 0 && (
                    <>
                      {" · "}
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        {undeliverableCount} not deliverable
                      </span>
                    </>
                  )}
                </p>
                <p className="text-sm font-semibold tabular-nums">{progress}%</p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={[
                    "h-full rounded-full transition-all",
                    completed || allDelivered ? "bg-success" : "bg-primary",
                  ].join(" ")}
                  style={{ width: `${progress}%` }}
                />
              </div>
              {completed && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
                  <PartyPopper className="h-4 w-4" />
                  Tour is completed.
                </p>
              )}
            </div>

            {/* Stopp-Liste + Rückkehr im Warehouse */}
            <ol className="space-y-2">
              {stops.map((stop, index) => {
                const delivered = stop.is_delivered;
                const undeliverable = stop.is_undeliverable === true;
                return (
                  <li key={stop.id}>
                    <div
                      role={stop.is_unknown ? undefined : "button"}
                      tabIndex={stop.is_unknown ? undefined : 0}
                      onClick={stop.is_unknown ? undefined : () => openStop(stop)}
                      onKeyDown={
                        stop.is_unknown
                          ? undefined
                          : (e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openStop(stop);
                              }
                            }
                      }
                      className={[
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        delivered
                          ? "border-success/30 bg-success/5 hover:bg-success/10"
                          : undeliverable
                            ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                            : "border-transparent bg-card hover:border-primary/40 hover:bg-accent/40",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          delivered
                            ? "bg-success text-success-foreground"
                            : undeliverable
                              ? "bg-amber-500 text-amber-50"
                              : "bg-foreground text-background",
                        ].join(" ")}
                      >
                        {delivered ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : undeliverable ? (
                          <XCircle className="h-4 w-4" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={
                              delivered
                                ? "font-medium text-muted-foreground"
                                : "font-medium"
                            }
                          >
                            {stop.is_unknown
                              ? stop.unknown_name ?? "Unknown destination"
                              : stop.object?.name ?? "Unknown object"}
                          </span>
                          {!stop.is_unknown && stop.key_number != null && (
                            <Badge variant="secondary">No. {stop.key_number}</Badge>
                          )}
                          {delivered && (
                            <Badge variant="success" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              delivered
                            </Badge>
                          )}
                          {undeliverable && (
                            <Badge variant="warning" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              not deliverable
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {cleanAddressLabel(
                            stop.is_unknown
                              ? stop.unknown_address ?? "Unknown address"
                              : stop.object?.address ?? "Unknown address",
                          )}
                        </span>
                        {undeliverable && stop.undeliverable_reason && (
                          <span className="mt-0.5 block text-xs font-medium text-amber-700 dark:text-amber-400">
                            Grund: {stop.undeliverable_reason}
                          </span>
                        )}
                        {stop.object?.remark && (
                          <ObjectRemark
                            remark={stop.object?.remark ?? ""}
                            objectName={stop.object?.name ?? "Unknown object"}
                            className="mt-0.5"
                          />
                        )}
                      </span>
                      {stop.arrival_time && (
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {stop.arrival_time?.slice(0, 5)}
                        </span>
                      )}
                      <NavigateButton
                        address={stop.is_unknown ? stop.unknown_address : stop.object?.address ?? null}
                        latitude={stop.is_unknown ? stop.unknown_latitude : stop.object?.latitude ?? null}
                        longitude={stop.is_unknown ? stop.unknown_longitude : stop.object?.longitude ?? null}
                        label={stop.is_unknown ? stop.unknown_name ?? "Unknown destination" : stop.object?.name ?? "Object"}
                      />
                      {stop.is_unknown && !delivered && !undeliverable && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={`${stop.unknown_name ?? "Unknown destination"} as delivered`}
                          title="Mark as delivered"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deliverUnknownStop(stop);
                          }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {!stop.is_unknown && (
                        <ChevronRight
                          className={delivered ? "h-4 w-4 shrink-0 text-muted-foreground" : "h-4 w-4 shrink-0 text-primary"}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Rückkehr im Warehouse: Ankunftszeit + Navigation genauso wie bei
                den normalen Zielen. (Offline ist das Warehouse nicht auflösbar –
                dann greift die bekannte Warehouseadresse als Navigationsziel.) */}
            {tour.warehouse_arrival && (
              <div className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Flag className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {tour.warehouse?.name ?? WAREHOUSE_NAME}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    Ankunft im Warehouse
                    {tour.warehouse?.address
                      ? ` · ${cleanAddressLabel(tour.warehouse.address)}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {tour.warehouse_arrival.slice(0, 5)}
                </span>
                <NavigateButton
                  address={tour.warehouse?.address ?? WAREHOUSE_ADDRESS}
                  latitude={tour.warehouse?.latitude ?? null}
                  longitude={tour.warehouse?.longitude ?? null}
                  label={tour.warehouse?.name ?? "Warehouse"}
                />
              </div>
            )}

            {/* Karte mit eingezeichneter Route (unten) */}
            <RouteMap warehouse={tour.warehouse} stops={mapStops} />

            <p className="text-center text-xs text-muted-foreground">
              Tap an object stop to confirm the delivery. Unknown targets are marked as delivered directly.
            </p>
          </div>
        )}
      </div>

      {/* Delivery-Dialog */}
      <DeliveryDialog
        open={dialog.open}
        tourId={tourId}
        stop={dialog.stop}
        onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
        onDelivered={() => void load(true)}
      />

      {/* Sticky-Leiste: auf dem Handy über der festen Stempeluhr-Leiste
          (bottom-14), on Desktop on unteren Rand. */}
      <div className="fixed inset-x-0 bottom-14 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:bottom-0">
        <div className="container flex h-16 items-center justify-between gap-3">
          {tour?.status === "packing" ? (
            <>
              <p className="min-w-0 text-sm text-muted-foreground">
                Tour has not started yet – pack first, then start the run.
              </p>
              <Button
                size="lg"
                onClick={() => void handleStartPackingTour()}
                disabled={starting}
                className="gap-2"
              >
                <Play />
                {starting ? "Starting…" : "Start the tour"}
              </Button>
            </>
          ) : completed ? (
            <>
              <p className="min-w-0 text-sm text-muted-foreground">
                Tour completed
              </p>
              <Button asChild>
                <Link href="/objects">
                  <Flag />
                  Go to object management
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="min-w-0 text-sm text-muted-foreground">
                {allDelivered
                  ? "All stops delivered – complete the tour."
                  : allResolved
                    ? `All stops processed – ${undeliverableCount} not deliverable.`
                    : `${openCount} stop${openCount === 1 ? "" : "s"} left`}
              </p>
              <Button
                size="lg"
                variant={allDelivered ? "default" : allResolved ? "default" : "outline"}
                onClick={() => void handleFinishTour()}
                disabled={!allResolved || finishing}
                className="gap-2"
              >
                <Flag />
                {finishing ? "Finishing…" : "End tour"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
