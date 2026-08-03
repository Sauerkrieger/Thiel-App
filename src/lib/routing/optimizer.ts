/**
 * Routen-Optimierung (Schritt 4)
 *
 * Ablauf: Adressen geocoden -> Live-Verkehrsmatrix (TomTom, optional) ->
 * ORS-Optimization-API (VROOM, Zeitfenster + Servicezeiten nativ) ->
 * Fallback: Fahrzeit-Matrix + TSP-Solver.
 *
 * Provider (priorisiert):
 *   1. OpenRouteService Optimization-API (ORS_API_KEY) – löst die Rundtour
 *      direkt. Ist ein TOMTOM_API_KEY gesetzt, werden die Fahrzeiten vorab
 *      als Live-Verkehrsmatrix (inkl. Staulage) abgefragt und als
 *      Custom-Matrix direkt in das VROOM-JSON eingespeist (matrices +
 *      location_index/start_index/end_index statt ORS-Routing-Backend).
 *      Schlägt die Matrix-Variante fehl, wird automatisch ohne Matrix
 *      wiederholt.
 *   2. OpenRouteService Matrix / Google Matrix + lokaler TSP-Solver
 *   3. Fallback "Demo-Modus": Haversine-Luftlinie + deterministische
 *      Hash-Koordinaten (stabil, aber nicht straßengenau)
 */

import {
  scheduleTimes,
  solveTspWithWindows,
} from "@/lib/routing/tsp";
import {
  fetchTomTomTrafficMatrix,
  type TrafficMatrix,
} from "@/lib/traffic-matrix";
import {
  normalizeAddressForGeocoding,
  orsAuthorizationHeader,
  orsGeocodeSearch,
} from "@/lib/ors";
import {
  findNearestDrivablePoint,
  type DrivablePoint,
} from "@/lib/overpass";
import {
  defaultStartTime,
  formatMinutes,
  prepMinutesForCount,
  serviceMinutesForCategory,
  toMinutes,
} from "@/lib/routing/time";
import {
  WAREHOUSE_NAME,
  WAREHOUSE_ADDRESS,
} from "@/lib/warehouse";
import type { ObjectCategory } from "@/types/database";

// Re-Export für bestehende Importe
// (WAREHOUSE_NAME/WAREHOUSE_ADDRESS liegen jetzt zentral in src/lib/warehouse.ts)
export { WAREHOUSE_NAME, WAREHOUSE_ADDRESS };

/* ------------------------------------------------------------------ */
/* Konstanten & Typen                                                  */
/* ------------------------------------------------------------------ */


/** Fußgängerzonen-Objekte MÜSSEN vor 11:00 Uhr angefahren werden. */
export const PEDESTRIAN_LIMIT_MINUTES = 11 * 60;

export const AVERAGE_SPEED_KMH = 30;

/** ORS-Matrix ist auf die Kostenstufe limitiert; darüber Luftlinie. */
const MAX_MATRIX_LOCATIONS = 20;

/** ORS-Optimization-API: getestet bis 50 Jobs; darüber Matrix-Fallback. */
const MAX_OPTIMIZATION_JOBS = 50;

/** Letzter Sekundenwert eines Tages (für offene ORS-Zeitfenster). */
const DAY_END_SECONDS = 24 * 60 * 60 - 1;

/**
 * Welcher Algorithmus/API die Reihenfolge tatsächlich gelöst hat:
 *   - ors-optimization: ORS Optimization-API (VROOM) direkt
 *   - ors-matrix:       Fahrzeit-Matrix (ORS) + lokaler TSP-Solver
 *   - google-matrix:    Fahrzeit-Matrix (Google) + lokaler TSP-Solver
 *   - haversine:        Demo-Modus (Luftlinie, ohne Routing-API)
 */
export type RoutingMode =
  | "ors-optimization"
  | "ors-matrix"
  | "google-matrix"
  | "haversine";

export type RouteObject = {
  id: string;
  name: string;
  address: string;
  category: ObjectCategory;
  is_pedestrian_zone_until_11: boolean;
  key_number: number | null;
  opens_at: string | null;
};

export type OptimizedStop = {
  object_id: string;
  name: string;
  address: string;
  arrival: string;
  departure: string;
  is_pedestrian_zone_until_11: boolean;
  key_number: number | null;
  opens_at: string | null;
  /** true, wenn der Stopp über einen befahrbaren Punkt außerhalb der Fußgängerzone angefahren wird. */
  approach_by_foot: boolean;
  /** Fußweg vom befahrbaren Punkt zum Objekt in Metern (nur bei approach_by_foot). */
  walking_distance_m: number | null;
  /** Koordinaten des Stopps, wie sie für die Route verwendet wurden (null im Demo-Modus). */
  latitude: number | null;
  longitude: number | null;
};

export type RouteOptimizationResult = {
  mode: RoutingMode;
  /** Tatsächliche Abfahrtszeit (ORS wählt sie innerhalb des gewählten Startfensters optimal). */
  start_time: string;
  /** Dauer der Vorbereitung am Lager (3 Min/Stopp + 5 Min Schlüssel). */
  prep_duration_minutes: number;
  /** Beginn der Vorbereitung am Lager (Abfahrt − Vorbereitungszeit). */
  prep_begin: string;
  /** Tatsächlicher Abfahrtszeitpunkt (= start_time). */
  departure_time: string;
  stops: OptimizedStop[];
  total_duration_minutes: number;
  warehouse_arrival: string;
  warnings: string[];
  /** Live-Verkehrsanbieter, dessen Fahrzeitmatrix in die Optimierung eingeflossen ist (null = ohne). */
  traffic_matrix_provider: "tomtom" | null;
  /** Lager (Start/Ziel der Rundtour) mit verifizierten Koordinaten (null im Demo-Modus). */
  warehouse: {
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

type Coordinate = { lat: number; lng: number };

/** Ergebnis des Geocodings inkl. Kennzeichen, ob ein Hash-Fallback genutzt wurde. */
type GeocodeResult = { coord: Coordinate; fallback: boolean };

/** Ergebnis der ORS-Optimization-API (aufbereitet). */
type OrsSolution = {
  /** Objekt-Nodes in Reihenfolge (1-basiert, ohne Lager). */
  order: number[];
  /** Ankunftszeiten (Minuten) je Stopp in `order`-Reihenfolge. */
  times: number[];
  /** Gesamtdauer in Minuten (inkl. Service- und Wartezeit, inkl. Rückfahrt). */
  totalMinutes: number;
  /** Tatsächliche Abfahrtszeit in Minuten (VROOM wählt sie im Fenster optimal). */
  departureMinutes: number;
};

/* ------------------------------------------------------------------ */
/* Geocoding (Zeit-Helfer siehe time.ts)                               */
/* ------------------------------------------------------------------ */

async function geocodeWithOrs(address: string): Promise<Coordinate | null> {
  const hit = await orsGeocodeSearch(address);
  return hit ? { lat: hit.latitude, lng: hit.longitude } : null;
}

async function geocodeWithGoogle(address: string): Promise<Coordinate | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const loc = json?.results?.[0]?.geometry?.location;
    if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch {
    /* Fallback unten */
  }
  return null;
}

/** Deterministische Pseudo-Koordinaten (Demo-Modus ohne API-Key). */
function hashCoordinate(address: string): Coordinate {
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = (h * 31 + address.charCodeAt(i)) | 0;
  }
  const lat = 52.4 + ((Math.abs(h) % 10000) / 10000) * 0.6;
  const lng = 13.2 + ((Math.abs(h >> 8) % 10000) / 10000) * 0.8;
  return { lat, lng };
}

async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const normalized = normalizeAddressForGeocoding(address);
  const ors = await geocodeWithOrs(normalized);
  if (ors) return { coord: ors, fallback: false };
  const google = await geocodeWithGoogle(normalized);
  if (google) return { coord: google, fallback: false };
  return { coord: hashCoordinate(address), fallback: true };
}

/* ------------------------------------------------------------------ */
/* ORS-Optimization-API (Primärweg)                                    */
/* ------------------------------------------------------------------ */

/**
 * Erweitert die N×N-Matrix (Indizes: 0 = Lager, 1..n = Objekte) um zwei
 * zusätzliche Zeilen/Spalten für das VROOM-Fahrzeug (start = n, end = n+1,
 * beide = Lager), damit die Matrix exakt zur ID-/Index-Zuordnung der Jobs
 * und des Fahrzeugs passt. Gibt null zurück, wenn das Format nicht stimmt.
 */
function expandMatrixForVehicle(
  src: number[][],
  jobCount: number,
): number[][] | null {
  if (src.length !== jobCount + 1) return null;
  const size = jobCount + 2;
  const out: number[][] = [];
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      // Job-Index i<n -> src-Zeile i+1; Fahrzeug-Index n/n+1 -> src-Zeile 0 (Lager)
      const srcRow = i < jobCount ? i + 1 : 0;
      const srcCol = j < jobCount ? j + 1 : 0;
      const value = src[srcRow]?.[srcCol];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return null;
      }
      row.push(Math.round(value));
    }
    out.push(row);
  }
  return out;
}

/**
 * Löst die Rundtour direkt über die ORS-Optimization-API (VROOM).
 *
 * Job-Zeitfenster = Array von [start,end]-Paaren (Sekunden), Fahrzeug-
 * Zeitfenster = flaches Paar [start,end]. Die gewählte Startzeit ist die
 * frühestmögliche Abfahrt; VROOM wählt die tatsächliche Abfahrt innerhalb
 * des Fensters optimal (später losfahren, um Wartezeit zu sparen).
 *
 * Wird `trafficMatrix` übergeben, ersetzt dessen Fahrzeitmatrix (inkl.
 * Live-Verkehr) die vom ORS-Backend berechneten Fahrzeiten: Die Jobs
 * bekommen location_index (0..n-1), das Fahrzeug start_index = n und
 * end_index = n+1 (beide = Lager), und die Matrix wird unter `matrices`
 * eingespeist. Ungültige Matrizen führen zu null (Aufrufer wiederholt
 * dann ohne Matrix).
 *
 * Rückgabe null bei: kein Key, HTTP-Fehler, code != 0 oder nicht alle
 * Jobs zugeordnet (unassigned > 0).
 */
async function solveWithOrsOptimization(
  coords: Coordinate[],
  earliest: number[],
  deadline: number[],
  startSec: number,
  serviceMinutes: number[],
  trafficMatrix?: TrafficMatrix | null,
): Promise<OrsSolution | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return null;

  const jobCount = coords.length - 1;
  const useMatrix = Boolean(trafficMatrix);
  const matrixDurations = trafficMatrix
    ? expandMatrixForVehicle(trafficMatrix.durations, jobCount)
    : null;
  if (useMatrix && !matrixDurations) {
    console.warn(
      "[ORS] TomTom-Fahrzeitmatrix ungültig (Format passt nicht zu den Jobs) – versuche ohne Live-Verkehr.",
    );
    return null;
  }

  const jobs = coords.slice(1).map((c, index) => {
    const node = index + 1;
    const windowStart = Math.max(0, earliest[node]) * 60;
    const windowEnd = Number.isFinite(deadline[node])
      ? deadline[node] * 60
      : DAY_END_SECONDS;
    // Unmögliches Fenster (Öffnet ab > Deadline): Fenster weglassen, sonst
    // lehnt VROOM die komplette Anfrage ab.
    const timeWindows =
      windowStart <= windowEnd
        ? [[windowStart, windowEnd]]
        : [[0, DAY_END_SECONDS]];
    return {
      id: node,
      location: [c.lng, c.lat],
      // Bei Custom-Matrix: expliziter Index in der Fahrzeitmatrix (0..n-1)
      ...(useMatrix ? { location_index: index } : {}),
      // Haltzeit je Kategorie (Treppenhaus 3 Min, Objekt 5 Min)
      service: serviceMinutes[node] * 60,
      time_windows: timeWindows,
    };
  });

  const warehouse = coords[0];
  const body = {
    jobs,
    vehicles: [
      {
        id: 1,
        profile: "driving-car",
        start: [warehouse.lng, warehouse.lat],
        end: [warehouse.lng, warehouse.lat],
        // Bei Custom-Matrix: Fahrzeug-Start/Ende als letzte Matrix-Indizes
        ...(useMatrix ? { start_index: jobCount, end_index: jobCount + 1 } : {}),
        time_window: [startSec, DAY_END_SECONDS],
      },
    ],
    // Custom-Matrix (Live-Verkehr) statt ORS-Routing-Backend
    ...(useMatrix && matrixDurations
      ? { matrices: { "driving-car": { durations: matrixDurations } } }
      : {}),
  };

  try {
    const res = await fetch("https://api.openrouteservice.org/optimization", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: orsAuthorizationHeader(apiKey),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(
        `[ORS] Optimization fehlgeschlagen (Status ${res.status}):`,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = await res.json();
    if (json?.code !== 0) {
      console.error("[ORS] Optimization ohne Lösung:", json?.error ?? json);
      return null;
    }
    const unassigned = json?.summary?.unassigned ?? 0;
    if (unassigned > 0) {
      console.warn(
        `[ORS] Optimization: ${unassigned} Job(s) nicht zugeordnet – Fallback.`,
      );
      return null;
    }
    const steps = json?.routes?.[0]?.steps as
      | Array<{ type?: string; id?: number; arrival?: number }>
      | undefined;
    if (!Array.isArray(steps)) return null;

    const startStep = steps.find((s) => s.type === "start");
    if (!startStep || typeof startStep.arrival !== "number") return null;

    const order: number[] = [];
    const times: number[] = [];
    let endArrival: number | null = null;
    for (const step of steps) {
      if (
        step.type === "job" &&
        typeof step.id === "number" &&
        typeof step.arrival === "number"
      ) {
        order.push(step.id);
        times.push(step.arrival / 60);
      } else if (step.type === "end" && typeof step.arrival === "number") {
        endArrival = step.arrival;
      }
    }
    if (order.length !== coords.length - 1) {
      console.warn("[ORS] Optimization: Reihenfolge unvollständig – Fallback.");
      return null;
    }

    const departureMinutes = startStep.arrival / 60;
    const endMinutes = endArrival !== null ? endArrival / 60 : departureMinutes;
    return {
      order,
      times,
      totalMinutes: Math.max(0, endMinutes - departureMinutes),
      departureMinutes,
    };
  } catch (err) {
    console.error("[ORS] Optimization-Anfrage fehlgeschlagen:", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Distanz-Matrix (Fallback)                                           */
/* ------------------------------------------------------------------ */

function haversineKm(a: Coordinate, b: Coordinate): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function haversineMinutes(coords: Coordinate[]): number[][] {
  return coords.map((a) =>
    coords.map((b) => (haversineKm(a, b) / AVERAGE_SPEED_KMH) * 60),
  );
}

async function matrixWithOrs(
  coords: Coordinate[],
): Promise<number[][] | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return null;
  if (coords.length > MAX_MATRIX_LOCATIONS) {
    console.warn(
      `[ORS] Matrix übersprungen: ${coords.length} Koordinaten > Limit ${MAX_MATRIX_LOCATIONS} – verwende Fallback.`,
    );
    return null;
  }
  try {
    const res = await fetch(
      "https://api.openrouteservice.org/v2/matrix/driving-car",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: orsAuthorizationHeader(apiKey),
        },
        body: JSON.stringify({
          locations: coords.map((c) => [c.lng, c.lat]),
          metrics: ["duration"],
          units: "m",
        }),
      },
    );
    if (!res.ok) {
      console.error(
        `[ORS] Matrix-Anfrage fehlgeschlagen (Status ${res.status}) für ${coords.length} Koordinaten:`,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = await res.json();
    const durations = json?.durations as number[][] | undefined;
    if (!Array.isArray(durations) || durations.length !== coords.length) {
      console.error(
        "[ORS] Matrix-Antwort unerwartet – durations fehlt oder passt nicht zur Anfrage:",
        json,
      );
      return null;
    }
    return durations.map((row) => row.map((sec) => sec / 60));
  } catch (err) {
    console.error("[ORS] Matrix-Anfrage fehlgeschlagen:", err);
    return null;
  }
}

async function matrixWithGoogle(
  coords: Coordinate[],
): Promise<number[][] | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || coords.length > 25) return null;
  try {
    const origins = coords
      .map((c) => `${c.lat},${c.lng}`)
      .join("|");
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(origins)}&units=metric&departure_time=now&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.status !== "OK") return null;
    const rows = json.rows as Array<{ elements: Array<{ status: string; duration: { value: number } }> }>;
    if (!Array.isArray(rows) || rows.length !== coords.length) return null;
    const matrix: number[][] = [];
    for (const row of rows) {
      if (!Array.isArray(row.elements) || row.elements.length !== coords.length) {
        return null;
      }
      matrix.push(
        row.elements.map((el) =>
          el.status === "OK" ? el.duration.value / 60 : Number.POSITIVE_INFINITY,
        ),
      );
    }
    return matrix;
  } catch {
    return null;
  }
}

/**
 * Versucht ORS-Matrix, dann Google-Matrix; sonst Haversine-Fallback
 * inkl. passender Warnung (einmalig pro Aufruf).
 */
async function resolveMatrix(
  coords: Coordinate[],
  warnings: string[],
): Promise<{ matrix: number[][]; mode: RoutingMode }> {
  const ors = await matrixWithOrs(coords);
  if (ors) return { matrix: ors, mode: "ors-matrix" };

  const google = await matrixWithGoogle(coords);
  if (google) return { matrix: google, mode: "google-matrix" };

  const hasOrsKey = Boolean(process.env.ORS_API_KEY);
  const hasGoogleKey = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  if (hasOrsKey || hasGoogleKey) {
    warnings.push(
      "Routing-API-Anfrage fehlgeschlagen (Details siehe Server-Log) – Demo-Modus mit Luftlinien-Distanzen aktiv. Prüfe den ORS_API_KEY oder die Anzahl der Objekte.",
    );
  } else {
    warnings.push(
      "Kein Routing-API-Key konfiguriert – Demo-Modus mit Luftlinien-Distanzen. Für exakte Fahrzeiten ORS_API_KEY oder GOOGLE_MAPS_API_KEY setzen.",
    );
  }
  return { matrix: haversineMinutes(coords), mode: "haversine" };
}

/* ------------------------------------------------------------------ */
/* ORS-Optimization mit optionalem Live-Verkehr                        */
/* ------------------------------------------------------------------ */

/**
 * Fragt die TomTom-Live-Verkehrsmatrix asynchron ab und versucht die
 * ORS-Optimization-API einmal MIT der Matrix. Schlägt das fehl, wird
 * automatisch OHNE Matrix wiederholt (Robustheit, falls die gehostete
 * VROOM-Instanz die Custom-Matrix nicht annimmt).
 *
 * `trafficUsed` = true, wenn die erfolgreiche Lösung die Live-Verkehrs-
 * matrix verwendet hat.
 */
async function tryOrsWithTraffic(
  coords: Coordinate[],
  earliest: number[],
  deadline: number[],
  startSec: number,
  serviceMinutes: number[],
  useTraffic: boolean,
): Promise<{
  solution: OrsSolution | null;
  trafficUsed: boolean;
  provider: "tomtom" | null;
}> {
  const traffic = useTraffic
    ? await fetchTomTomTrafficMatrix(coords)
    : null;

  const withMatrix = await solveWithOrsOptimization(
    coords,
    earliest,
    deadline,
    startSec,
    serviceMinutes,
    traffic,
  );
  if (withMatrix) {
    return {
      solution: withMatrix,
      trafficUsed: Boolean(traffic),
      provider: traffic?.provider ?? null,
    };
  }

  if (traffic) {
    const plain = await solveWithOrsOptimization(
      coords,
      earliest,
      deadline,
      startSec,
      serviceMinutes,
      null,
    );
    return { solution: plain, trafficUsed: false, provider: null };
  }

  return { solution: null, trafficUsed: false, provider: null };
}

/* ------------------------------------------------------------------ */
/* Hauptfunktion                                                       */
/* ------------------------------------------------------------------ */

export async function optimizeRoute(
  objects: RouteObject[],
  startTime?: string,
): Promise<RouteOptimizationResult> {
  const warnings: string[] = [];
  // Vorbereitung am Lager: 3 Min Packzeit pro Stopp + einmalig 5 Min Schlüssel
  const prepMinutes = prepMinutesForCount(objects.length);
  // Haltzeit je Ziel: Treppenhaus 3 Min, Objekt 5 Min (Node 0 = Lager, 0 Min)
  const serviceMinutes = [
    0,
    ...objects.map((o) => serviceMinutesForCategory(o.category)),
  ];
  // Standard-Startzeit: aktuelle Uhrzeit + Vorbereitungszeit (auf 5 Min gerundet).
  // Die gewählte Startzeit ist die frühestmögliche Abfahrt.
  const resolvedStartTime = startTime ?? defaultStartTime(prepMinutes);
  const start = toMinutes(resolvedStartTime);
  const startSec = start * 60;

  const warehouseGeo = await geocodeAddress(WAREHOUSE_ADDRESS);
  const warehouseCoord = warehouseGeo.coord;
  const objectGeos = await Promise.all(
    objects.map((o) => geocodeAddress(o.address)),
  );
  const objectCoords = objectGeos.map((g) => g.coord);
  const coords: Coordinate[] = [warehouseCoord, ...objectCoords];
  // Koordinaten, die tatsächlich für die Routing-Lösung verwendet wurden
  // (werden beim Fußgängerzonen-Umweg auf die befahrbaren Punkte ersetzt).
  let routingCoords: Coordinate[] = coords;

  // Zeitfenster (Node 0 = Lager)
  const earliest = [0, ...objects.map((o) => (o.opens_at ? toMinutes(o.opens_at) : 0))];
  const deadlineDirect = [
    Number.POSITIVE_INFINITY,
    ...objects.map((o) =>
      o.is_pedestrian_zone_until_11
        ? PEDESTRIAN_LIMIT_MINUTES
        : Number.POSITIVE_INFINITY,
    ),
  ];

  const pedestrianIndexes = objects
    .map((obj, index) => (obj.is_pedestrian_zone_until_11 ? index : -1))
    .filter((index) => index >= 0);

  // Objekt-Index -> Fußweg in Metern (nur bei approach_by_foot)
  const walkingDistances = new Map<number, number>();

  /* ---- Phase 1: ORS-Optimization-API (Primärweg) ---------------------- */
  let orsSolution: OrsSolution | null = null;
  // Live-Verkehrsanbieter, dessen Matrix tatsächlich verwendet wurde
  let trafficMatrixProvider: "tomtom" | null = null;
  const hasOrsKey = Boolean(process.env.ORS_API_KEY);
  const hasTomTomKey = Boolean(process.env.TOMTOM_API_KEY);
  if (hasOrsKey && coords.length <= MAX_OPTIMIZATION_JOBS) {
    const first = await tryOrsWithTraffic(
      coords,
      earliest,
      deadlineDirect,
      startSec,
      serviceMinutes,
      hasTomTomKey,
    );
    if (first.solution) {
      orsSolution = first.solution;
      if (first.trafficUsed) {
        trafficMatrixProvider = first.provider;
      } else if (hasTomTomKey) {
        warnings.push(
          "TomTom-Live-Verkehr konnte nicht angewendet werden (Details siehe Server-Log) – Route ohne Live-Verkehr berechnet.",
        );
      }
    }

    // Umweg-Routing bei nicht erfüllbaren Zeitfenstern (Fußgängerzone)
    if (!orsSolution && pedestrianIndexes.length > 0) {
      const drivable = await Promise.all(
        pedestrianIndexes.map(async (objIndex) => {
          const point = await findNearestDrivablePoint(objectCoords[objIndex]);
          return { objIndex, point };
        }),
      );
      const usable = drivable.filter(
        (entry): entry is { objIndex: number; point: DrivablePoint } =>
          entry.point !== null,
      );
      if (usable.length > 0) {
        const detourCoords = coords.map((coord, index) => {
          const hit = usable.find((u) => u.objIndex + 1 === index);
          return hit ? hit.point : coord;
        });
        const deadlineDetour = deadlineDirect.map((d, index) =>
          usable.some((u) => u.objIndex + 1 === index)
            ? Number.POSITIVE_INFINITY
            : d,
        );
        // Frische Matrix für die geänderten Koordinaten abfragen
        const detour = await tryOrsWithTraffic(
          detourCoords,
          earliest,
          deadlineDetour,
          startSec,
          serviceMinutes,
          hasTomTomKey,
        );
        if (detour.solution) {
          orsSolution = detour.solution;
          routingCoords = detourCoords;
          if (detour.trafficUsed) {
            trafficMatrixProvider = detour.provider;
          } else if (hasTomTomKey) {
            warnings.push(
              "TomTom-Live-Verkehr konnte nicht angewendet werden (Details siehe Server-Log) – Route ohne Live-Verkehr berechnet.",
            );
          }
          usable.forEach((u) =>
            walkingDistances.set(u.objIndex, Math.round(u.point.distance_meters)),
          );
          warnings.push(
            "Fußgängerzonen-Objekte werden über den nächstgelegenen befahrbaren Haltepunkt angefahren (Restweg zu Fuß, Zeitfenster „vor 11:00“ entfällt für diese Stopps).",
          );
        }
      }
    }

    if (!orsSolution) {
      warnings.push(
        "Die ORS-Optimierung konnte keine Lösung finden (Details siehe Server-Log) – Fallback auf Matrix + lokalen Solver.",
      );
    }
  } else if (hasOrsKey) {
    warnings.push(
      `Mehr als ${MAX_OPTIMIZATION_JOBS} Ziele – ORS-Optimierung übersprungen, nutze Matrix + lokalen Solver.`,
    );
  }

  let order: number[];
  let times: number[];
  let total: number;
  let departureMinutes: number;
  let mode: RoutingMode;

  if (orsSolution) {
    mode = "ors-optimization";
    order = orsSolution.order;
    times = orsSolution.times;
    total = orsSolution.totalMinutes;
    departureMinutes = orsSolution.departureMinutes;
  } else {
    /* ---- Phase 2: Matrix + TSP (Fallback) ------------------------------ */
    let { matrix, mode: matrixMode } = await resolveMatrix(coords, warnings);
    mode = matrixMode;
    let solution = solveTspWithWindows(
      matrix,
      earliest,
      deadlineDirect,
      start,
      serviceMinutes,
    );
    let finalMatrix = matrix;
    let finalDeadline = deadlineDirect;

    // Umweg-Routing bei nicht erfüllbaren Zeitfenstern (Fußgängerzone)
    if (!solution.feasible && pedestrianIndexes.length > 0) {
      const drivable = await Promise.all(
        pedestrianIndexes.map(async (objIndex) => {
          const point = await findNearestDrivablePoint(objectCoords[objIndex]);
          return { objIndex, point };
        }),
      );
      const usable = drivable.filter(
        (entry): entry is { objIndex: number; point: DrivablePoint } =>
          entry.point !== null,
      );
      if (usable.length > 0) {
        const detourCoords = coords.map((coord, index) => {
          const hit = usable.find((u) => u.objIndex + 1 === index);
          return hit ? hit.point : coord;
        });
        const detour = await resolveMatrix(detourCoords, warnings);
        const deadlineDetour = deadlineDirect.map((d, index) =>
          usable.some((u) => u.objIndex + 1 === index)
            ? Number.POSITIVE_INFINITY
            : d,
        );
        const solutionDetour = solveTspWithWindows(
          detour.matrix,
          earliest,
          deadlineDetour,
          start,
          serviceMinutes,
        );
        if (solutionDetour.feasible) {
          finalMatrix = detour.matrix;
          finalDeadline = deadlineDetour;
          solution = solutionDetour;
          mode = detour.mode;
          routingCoords = detourCoords;
          usable.forEach((u) =>
            walkingDistances.set(u.objIndex, Math.round(u.point.distance_meters)),
          );
          warnings.push(
            "Fußgängerzonen-Objekte werden über den nächstgelegenen befahrbaren Haltepunkt angefahren (Restweg zu Fuß, Zeitfenster „vor 11:00“ entfällt für diese Stopps).",
          );
        }
      }
    }

    order = solution.order;
    times = scheduleTimes(
      order,
      finalMatrix,
      earliest,
      finalDeadline,
      start,
      serviceMinutes,
      true,
    ) ?? scheduleTimes(
      order,
      finalMatrix,
      earliest,
      finalDeadline,
      start,
      serviceMinutes,
      false,
    ) ?? [];
    total = Number.isFinite(solution.totalMinutes) ? solution.totalMinutes : 0;
    departureMinutes = start;

    if (!solution.feasible) {
      warnings.push(
        "Die Zeit-Restriktionen können mit der gewählten Startzeit nicht für alle Objekte erfüllt werden (z. B. Fußgängerzone vor 11:00 Uhr). Bitte Startzeit anpassen oder Objekte entfernen.",
      );
    }
  }

  // Doppelte Warnungen (z. B. aus Phase 1 + Phase 2) entfernen
  const uniqueWarnings = [...new Set(warnings)];

  const stops: OptimizedStop[] = order.map((node, index) => {
    const obj = objects[node - 1];
    const arrival = times[index];
    const walking = walkingDistances.get(node - 1);
    // Koordinaten, die für die Route tatsächlich verwendet wurden
    // (befahrbarer Punkt bei approach_by_foot, sonst Objekt-Adresse).
    const coord = routingCoords[node];
    // Demo-Modus: Hash-Koordinaten sind erfunden -> auf der Karte ausblenden.
    const fallbackCoord = walking !== undefined
      ? false
      : (objectGeos[node - 1]?.fallback ?? true);
    return {
      object_id: obj.id,
      name: obj.name,
      address: obj.address,
      arrival: formatMinutes(arrival),
      departure: formatMinutes(arrival + serviceMinutes[node]),
      is_pedestrian_zone_until_11: obj.is_pedestrian_zone_until_11,
      key_number: obj.key_number,
      opens_at: obj.opens_at,
      approach_by_foot: walking !== undefined,
      walking_distance_m: walking ?? null,
      latitude: fallbackCoord || !coord ? null : coord.lat,
      longitude: fallbackCoord || !coord ? null : coord.lng,
    };
  });

  const warehouseArrival = formatMinutes(departureMinutes + total);

  return {
    mode,
    start_time: formatMinutes(departureMinutes),
    prep_duration_minutes: prepMinutes,
    prep_begin: formatMinutes(Math.max(0, departureMinutes - prepMinutes)),
    departure_time: formatMinutes(departureMinutes),
    stops,
    total_duration_minutes: Math.round(total),
    warehouse_arrival: warehouseArrival,
    warnings: uniqueWarnings,
    traffic_matrix_provider: trafficMatrixProvider,
    warehouse: warehouseGeo.fallback
      ? null
      : {
          name: WAREHOUSE_NAME,
          address: WAREHOUSE_ADDRESS,
          latitude: warehouseCoord.lat,
          longitude: warehouseCoord.lng,
        },
  };
}
