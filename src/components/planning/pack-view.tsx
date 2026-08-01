"use client";

import {
  AlertTriangle,
  Clock,
  Flag,
  Footprints,
  KeyRound,
  MapPin,
  Route,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/routing/time";
import type { OptimizedStop, RouteOptimizationResult } from "@/types/api";

type Props = {
  route: RouteOptimizationResult;
  onOpenStop: (stop: OptimizedStop) => void;
};

const MODE_LABELS: Record<
  RouteOptimizationResult["mode"],
  { label: string; variant: "secondary" | "outline" | "success" }
> = {
  openrouteservice: { label: "OpenRouteService", variant: "success" },
  google: { label: "Google Maps", variant: "success" },
  haversine: { label: "Demo (Luftlinie)", variant: "secondary" },
};

export function PackView({ route, onOpenStop }: Props) {
  const mode = MODE_LABELS[route.mode];

  // Schlüssel-Packliste: alle Schlüsselnummern der Tour, aufsteigend sortiert
  const keyNumbers = route.stops
    .map((stop) => stop.key_number)
    .filter((key): key is number => typeof key === "number");
  const sortedKeys = [...new Set(keyNumbers)].sort((a, b) => a - b);

  return (
    <div className="space-y-5">
      {/* Zusammenfassung */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={mode.variant} className="gap-1">
            <Route className="h-3 w-3" />
            {mode.label}
          </Badge>
          <Badge variant="secondary">{route.stops.length} Stopps</Badge>
          <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
            <Truck className="h-4 w-4 text-primary" />
            Vorbereitung {route.prep_duration_minutes} Min · Abfahrt{" "}
            {route.departure_time} · Lager-Rückkehr ~{route.warehouse_arrival}{" "}
            · ca. {formatDuration(route.total_duration_minutes)}
          </span>
        </div>

        {/* Schlüssel-Packliste */}
        {sortedKeys.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">Schlüssel mitnehmen:</span>{" "}
              {sortedKeys.map((key) => `Nr. ${key}`).join(", ")}
            </span>
          </div>
        )}

        {route.warnings.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {route.warnings.map((warning) => (
              <p
                key={warning}
                className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Stopp-Timeline */}
      <ol className="relative space-y-2 pl-6">
        <li className="absolute bottom-0 left-[11px] top-2 w-px bg-border" />
        {/* Startpunkt */}
        <li className="relative flex items-center gap-3 rounded-lg border bg-primary/5 px-3 py-2.5">
          <span className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Flag className="h-3 w-3" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Thiel Dienstleistungen (Lager)</p>
            <p className="text-xs text-muted-foreground">
              Abfahrt um {route.start_time} Uhr
            </p>
          </div>
        </li>

        {route.stops.map((stop, index) => (
          <li key={stop.object_id} className="relative">
            <button
              type="button"
              onClick={() => onOpenStop(stop)}
              className={[
                "flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40",
              ].join(" ")}
            >
              <span className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{stop.name}</span>
                  {stop.key_number != null && (
                    <Badge variant="secondary">Schlüssel Nr. {stop.key_number}</Badge>
                  )}
                  {stop.approach_by_foot ? (
                    <Badge variant="warning" className="gap-1">
                      <Footprints className="h-3 w-3" />
                      {stop.walking_distance_m != null
                        ? `${Math.round(stop.walking_distance_m)} m zu Fuß`
                        : "zu Fuß"}
                    </Badge>
                  ) : stop.is_pedestrian_zone_until_11 ? (
                    <Badge variant="warning">vor 11:00</Badge>
                  ) : null}
                  {stop.opens_at && (
                    <Badge variant="outline">ab {stop.opens_at.slice(0, 5)}</Badge>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {stop.address}
                </span>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {stop.arrival}
                </span>
              </span>
            </button>
          </li>
        ))}

        {/* Endpunkt */}
        <li className="relative flex items-center gap-3 rounded-lg border bg-primary/5 px-3 py-2.5">
          <span className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Flag className="h-3 w-3" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Thiel Dienstleistungen (Lager)</p>
            <p className="text-xs text-muted-foreground">
              Rückkehr um ~{route.warehouse_arrival} Uhr
            </p>
          </div>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Truck className="h-4 w-4" />
            Gesamt ca. {formatDuration(route.total_duration_minutes)}
          </span>
        </li>
      </ol>

      <p className="text-center text-xs text-muted-foreground">
        Tippe auf einen Stopp, um die Packliste zu prüfen. Extra-Items für die
        nächste Tour werden während der Auslieferung vorgemerkt.
      </p>
    </div>
  );
}
