"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPinOff, Route as RouteIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type MapStop = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** true, wenn der Stopp bereits beliefert wurde (Tour-Ansicht). */
  delivered?: boolean;
  /** Zusatztext (z. B. "zu Fuß") unter dem Namen im Popup. */
  note?: string;
};

export type MapWarehouse = {
  name: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  warehouse: MapWarehouse | null;
  /** Stopps in der Reihenfolge der Route. */
  stops: MapStop[];
  className?: string;
};

type Waypoint = {
  lat: number;
  lng: number;
  kind: "warehouse" | "stop";
  label: string;
  index?: number;
  delivered?: boolean;
  note?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Markierungs-Icon (nummerierter Kreis bzw. Lager-Pin) als HTML. */
function markerHtml(waypoint: Waypoint): string {
  const base =
    "display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;font-size:11px;font-weight:700;font-family:ui-sans-serif,system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3);border:2px solid #ffffff;";
  if (waypoint.kind === "warehouse") {
    return `<div style="${base}background:#111827;color:#ffffff;font-size:13px;">&#9873;</div>`;
  }
  if (waypoint.delivered) {
    return `<div style="${base}background:#16a34a;color:#ffffff;">&#10003;</div>`;
  }
  return `<div style="${base}background:#ffffff;color:#2563eb;border-color:#2563eb;">${waypoint.index ?? ""}</div>`;
}

export function RouteMap({ warehouse, stops, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const [loadingGeometry, setLoadingGeometry] = useState(false);
  const [geometryFailed, setGeometryFailed] = useState(false);
  const [line, setLine] = useState<[number, number][] | null>(null);

  // Gültige Wegpunkte in Routen-Reihenfolge (Lager -> Stopps)
  const waypoints = useMemo<Waypoint[]>(() => {
    const out: Waypoint[] = [];
    if (
      warehouse &&
      typeof warehouse.latitude === "number" &&
      typeof warehouse.longitude === "number"
    ) {
      out.push({
        lat: warehouse.latitude,
        lng: warehouse.longitude,
        kind: "warehouse",
        label: warehouse.name,
      });
    }
    stops.forEach((stop, index) => {
      if (
        typeof stop.latitude === "number" &&
        typeof stop.longitude === "number"
      ) {
        out.push({
          lat: stop.latitude,
          lng: stop.longitude,
          kind: "stop",
          label: stop.name,
          index: index + 1,
          delivered: stop.delivered,
          note: stop.note,
        });
      }
    });
    return out;
  }, [warehouse, stops]);

  // Karte initialisieren (nur im Browser, nach dem Mount)
  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Größe nach dem Einfügen korrigieren (Container kann initial 0 hoch sein)
    const t = window.setTimeout(() => map.invalidateSize(), 150);
    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // ORS-Straßenverlauf für die Wegpunkt-Reihenfolge abrufen (Rundtour)
  useEffect(() => {
    if (waypoints.length < 2) {
      setLine(null);
      setGeometryFailed(false);
      setLoadingGeometry(false);
      return;
    }
    let cancelled = false;
    setLoadingGeometry(true);
    setGeometryFailed(false);
    // Rundtour: Lager -> Stopps -> Lager (Rückweg zum Lager mitschicken)
    const closesAtWarehouse =
      waypoints.length >= 2 && waypoints[0].kind === "warehouse";
    const coordinates = [
      ...waypoints.map((w) => [w.lng, w.lat]),
      ...(closesAtWarehouse ? [[waypoints[0].lng, waypoints[0].lat]] : []),
    ];
    fetch("/api/planning/route-geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates }),
    })
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (
          Array.isArray(body?.coordinates) &&
          body.coordinates.length >= 2
        ) {
          setLine(
            body.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
          );
        } else {
          setLine(null);
          setGeometryFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLine(null);
          setGeometryFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingGeometry(false);
      });
    return () => {
      cancelled = true;
    };
  }, [waypoints]);

  // Linie + Marker zeichnen
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (waypoints.length === 0) return;

    if (line && line.length >= 2) {
      L.polyline(line, {
        color: "#2563eb",
        weight: 4,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layer);
    } else {
      // Fallback: direkte Verbindungen in Stopp-Reihenfolge (inkl. Rückweg)
      const closesAtWarehouse =
        waypoints.length >= 2 && waypoints[0].kind === "warehouse";
      L.polyline(
        [
          ...waypoints.map((w) => [w.lat, w.lng] as [number, number]),
          ...(closesAtWarehouse
            ? [[waypoints[0].lat, waypoints[0].lng] as [number, number]]
            : []),
        ],
        {
          color: "#94a3b8",
          weight: 3,
          opacity: 0.7,
          dashArray: "6 8",
        },
      ).addTo(layer);
    }

    waypoints.forEach((w) => {
      const marker = L.marker([w.lat, w.lng], {
        icon: L.divIcon({
          className: "",
          html: markerHtml(w),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -14],
        }),
        title: w.label,
      });
      const note =
        w.kind === "warehouse"
          ? "<br/><span style=\"color:#64748b\">Lager (Start &amp; Ziel)</span>"
          : w.note
            ? `<br/><span style="color:#64748b">${escapeHtml(w.note)}</span>`
            : "";
      marker.bindPopup(
        `<div style="font-size:12px;line-height:1.45"><strong>${escapeHtml(w.label)}</strong>${note}</div>`,
      );
      marker.addTo(layer);
    });

    const bounds = L.latLngBounds(waypoints.map((w) => [w.lat, w.lng]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
  }, [waypoints, line]);

  return (
    <div
      className={cn(
        // z-0 erzeugt einen Stacking-Context: Die internen Leaflet-z-index-Werte
        // (Zoom-Controls 1000, Popup-Pane 700, …) bleiben so innerhalb der Karte
        // und können Dialoge/Overlays mit höherem z-index (z-50) nicht mehr überdecken.
        "relative z-0 h-72 overflow-hidden rounded-xl border bg-muted/20 shadow-sm sm:h-80",
        className,
      )}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* Überlagerungen */}
      {waypoints.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/80 p-6 text-center">
          <MapPinOff className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Keine Koordinaten verfügbar</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Für die Routen-Objekte sind keine verifizierten Adress-Koordinaten
            hinterlegt.
          </p>
        </div>
      ) : (
        <>
          {loadingGeometry && (
            <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Route wird geladen…
            </div>
          )}
          {!loadingGeometry && geometryFailed && (
            <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-amber-50/95 px-2.5 py-1 text-xs font-medium text-amber-800 shadow-sm">
              <RouteIcon className="h-3.5 w-3.5" />
              Straßenverlauf nicht verfügbar
            </div>
          )}
        </>
      )}
    </div>
  );
}
