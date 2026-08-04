"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flag,
  MapPin,
  PartyPopper,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupHint } from "@/components/setup-hint";
import { RouteMap } from "@/components/map/route-map";
import { ObjectRemark } from "@/components/objects/object-remark";
import { cleanAddressLabel } from "@/lib/address";
import { DeliveryDialog } from "./delivery-dialog";
import { NavigateButton } from "./navigate-button";
import { offlineFetch } from "@/lib/offline/fetch";
import type { ApiError, TourStopWithObject, TourWithStops } from "@/types/api";

const STATUS_LABELS: Record<TourWithStops["status"], string> = {
  packing: "Packen",
  in_transit: "Unterwegs",
  completed: "Abgeschlossen",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await offlineFetch(`/api/tours/${tourId}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError({ code: body.code, message: body.error ?? "Unbekannter Fehler" });
        return;
      }
      setTour(body.tour);
    } catch {
      setError({ message: "Netzwerkfehler beim Laden der Tour." });
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
        name: stop.object?.name ?? "Unbekanntes Objekt",
        latitude: stop.object?.latitude ?? null,
        longitude: stop.object?.longitude ?? null,
        delivered: stop.is_delivered,
      })),
    [stops],
  );
  const total = stops.length;
  const deliveredCount = stops.filter((stop) => stop.is_delivered).length;
  const allDelivered = total > 0 && deliveredCount === total;
  const progress = total > 0 ? Math.round((deliveredCount / total) * 100) : 0;
  const completed = tour?.status === "completed";

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
        toast.error(body.error ?? "Tour konnte nicht abgeschlossen werden.");
        return;
      }
      toast.success("Tour abgeschlossen – starke Leistung!");
      router.push("/objects");
    } catch {
      toast.error("Tour konnte nicht abgeschlossen werden.");
    } finally {
      setFinishing(false);
    }
  }

  function openStop(stop: TourStopWithObject) {
    setDialog({ open: true, stop });
  }

  return (
    <div className="container pb-28 pt-6 sm:pt-10">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tour unterwegs</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {tour && (
              <>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-4 w-4" />
                  {new Date(tour.date + "T00:00:00").toLocaleDateString("de-DE", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                {tour.start_time && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Start {tour.start_time.slice(0, 5)} Uhr
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-4 w-4" />
                  {total} Stopps
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link href="/planung">
              <ArrowLeft />
              Zur Tourenplanung
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
            Tour nicht gefunden.
          </div>
        ) : (          <div className="space-y-4">
            {/* Fortschritt */}
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="font-semibold">{deliveredCount}</span> von{" "}
                  {total} Objekten beliefert
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
                  Tour ist abgeschlossen.
                </p>
              )}
            </div>

            {/* Stopp-Liste */}
            <ol className="space-y-2">
              {stops.map((stop, index) => {
                const delivered = stop.is_delivered;
                return (
                  <li key={stop.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openStop(stop)}
                      onKeyDown={(e) => {
                        // Nur reagieren, wenn die Zeile selbst fokussiert ist
                        // (Enter/Space auf inneren Buttons wie Navigation /
                        // Bemerkung soll NICHT zusätzlich den Dialog öffnen).
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openStop(stop);
                        }
                      }}
                      className={[
                        "flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        delivered
                          ? "border-success/30 bg-success/5 hover:bg-success/10"
                          : "border-transparent bg-card hover:border-primary/40 hover:bg-accent/40",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          delivered
                            ? "bg-success text-success-foreground"
                            : "bg-foreground text-background",
                        ].join(" ")}
                      >
                        {delivered ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={delivered ? "font-medium text-muted-foreground" : "font-medium"}
                          >
                            {stop.object?.name ?? "Unbekanntes Objekt"}
                          </span>
                          {delivered && (
                            <Badge variant="success" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              beliefert
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {cleanAddressLabel(
                            stop.object?.address ?? "Adresse unbekannt",
                          )}
                        </span>
                        {stop.object?.remark && (
                          <ObjectRemark
                            remark={stop.object.remark}
                            objectName={stop.object.name}
                            className="mt-0.5"
                          />
                        )}
                      </span>
                      {stop.arrival_time && (
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {stop.arrival_time.slice(0, 5)}
                        </span>
                      )}
                      <NavigateButton
                        latitude={stop.object?.latitude ?? null}
                        longitude={stop.object?.longitude ?? null}
                        label={stop.object?.name ?? "Objekt"}
                      />
                      <ChevronRight
                        className={delivered ? "h-4 w-4 shrink-0 text-muted-foreground" : "h-4 w-4 shrink-0 text-primary"}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Karte mit eingezeichneter Route (unten) */}
            <RouteMap warehouse={tour.warehouse} stops={mapStops} />

            <p className="text-center text-xs text-muted-foreground">
              Tippe auf einen Stopp, um die Lieferung zu bestätigen und Items
              für das nächste Mal vorzumerken.
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
        onDelivered={() => void load()}
      />

      {/* Sticky-Leiste */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container flex h-16 items-center justify-between gap-3">
          {completed ? (
            <>
              <p className="min-w-0 text-sm text-muted-foreground">
                Tour abgeschlossen
              </p>
              <Button asChild>
                <Link href="/objects">
                  <Flag />
                  Zur Objektverwaltung
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="min-w-0 text-sm text-muted-foreground">
                {allDelivered
                  ? "Alle Stopps beliefert – Tour abschließen."
                  : `Noch ${total - deliveredCount} Stopp${total - deliveredCount === 1 ? "" : "s"} offen`}
              </p>
              <Button
                size="lg"
                variant={allDelivered ? "default" : "outline"}
                onClick={() => void handleFinishTour()}
                disabled={!allDelivered || finishing}
                className="gap-2"
              >
                <Flag />
                {finishing ? "Wird abgeschlossen…" : "Tour beenden"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
