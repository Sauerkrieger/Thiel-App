/**
 * Routen-Optimierung (Schritt 4)
 *
 * Ablauf: Adressen geocoden -> ORS-Optimization-API (VROOM, Zeitfenster +
 * Servicezeiten nativ) -> Fallback: Fahrzeit-Matrix + TSP-Solver.
 *
 * Provider (priorisiert):
 *   1. OpenRouteService Optimization-API (ORS_API_KEY) – löst die Rundtour
 *      direkt (Zeitfenster "öffnet ab" / "Fußgängerzone bis 11:00" und
 *      10 Min Servicezeit werden als Job-Zeitfenster/-Service übergeben)
 *   2. OpenRouteService Matrix / Google Matrix + lokaler TSP-Solver
 *   3. Fallback "Demo-Modus": Haversine-Luftlinie + deterministische
 *      Hash-Koordinaten (stabil, aber nicht straßengenau)
 */

import {
  scheduleTimes,
  solveTspWithWindows,
} from "@/lib/routing/tsp";
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
  toMinutes,
} from "@/lib/routing/time";

/* ------------------------------------------------------------------ */
/* Konstanten & Typen                                                  */
/* ------------------------------------------------------------------ */

export const WAREHOUSE_NAME = "Thiel Dienstleistungen";
export const WAREHOUSE_ADDRESS =
  process.env.WAREHOUSE_ADDRESS ??
  "Sartoriusstraße 14, 97072 Würzburg";

/** Fußgängerzonen-Objekte MÜSSEN vor 11:00 Uhr angefahren werden. */
export const PEDESTRIAN_LIMIT_MINUTES = 11 * 60;

/** Verweildauer/Entladezeit an jedem Zielobjekt (vor Weiterfahrt). */
export const SERVICE_MINUTES = 10;
export const AVERAGE_SPEED_KMH = 30;

/** ORS-Matrix ist auf die Kostenstufe limitiert; darüber Luftlinie. */
const MAX_MATRIX_LOCATIONS = 20;

/** ORS-Optimization-API: getestet bis 50 Jobs; darüber Matrix-Fallback. */
const MAX_OPTIMIZATION_JOBS = 50;

/** Letzter Sekundenwert eines Tages (für offene ORS-Zeitfenster). */
const DAY_END_SECONDS = 24 * 60 * 60 - 1;

export type RoutingMode = "openrouteservice" | "google" | "haversine";

export type RouteObject = {
  id: string;
  name: string;
  address: string;
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
};

export type RouteOptimizationResult = {
  mode: RoutingMode;
  /** Tatsächliche Abfahrtszeit (ORS wählt sie innerhalb des gewählten Startfensters optimal). */
  start_time: string;
  /** Dauer der Vorbereitung am Lager (5 Min/Stopp + 5 Min Schlüssel). */
  prep_duration_minutes: number;
  /** Beginn der Vorbereitung am Lager (Abfahrt − Vorbereitungszeit). */
  prep_begin: string;
  /** Tatsächlicher Abfahrtszeitpunkt (= start_time). */
  departure_time: string;
  stops: OptimizedStop[];
  total_duration_minutes: number;
  warehouse_arrival: string;
  warnings: string[];
};

type Coordinate = { lat: number; lng: number };

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

async function geocodeAddress(address: string): Promise<Coordinate> {
  const normalized = normalizeAddressForGeocoding(address);
  return (await geocodeWithOrs(normalized)) ??
    (await geocodeWithGoogle(normalized)) ??
    hashCoordinate(address);
}

/* ------------------------------------------------------------------ */
/* ORS-Optimization-API (Primärweg)                                    */
/* ------------------------------------------------------------------ */

/**
 * Löst die Rundtour direkt über die ORS-Optimization-API (VROOM).
 *
 * Job-Zeitfenster = Array von [start,end]-Paaren (Sekunden), Fahrzeug-
 * Zeitfenster = flaches Paar [start,end]. Die gewählte Startzeit ist die
 * frühestmögliche Abfahrt; VROOM wählt die tatsächliche Abfahrt innerhalb
 * des Fensters optimal (später losfahren, um Wartezeit zu sparen).
 *
 * Rückgabe null bei: kein Key, HTTP-Fehler, code != 0 oder nicht alle
 * Jobs zugeordnet (unassigned > 0).
 */
async function solveWithOrsOptimization(
  coords: Coordinate[],
  earliest: number[],
  deadline: number[],
  startSec: number,
): Promise<OrsSolution | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return null;

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
      service: SERVICE_MINUTES * 60,
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
        time_window: [startSec, DAY_END_SECONDS],
      },
    ],
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
  if (ors) return { matrix: ors, mode: "openrouteservice" };

  const google = await matrixWithGoogle(coords);
  if (google) return { matrix: google, mode: "google" };

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
/* Hauptfunktion                                                       */
/* ------------------------------------------------------------------ */

export async function optimizeRoute(
  objects: RouteObject[],
  startTime?: string,
): Promise<RouteOptimizationResult> {
  const warnings: string[] = [];
  // Vorbereitung am Lager: 5 Min Packzeit pro Stopp + einmalig 5 Min Schlüssel
  const prepMinutes = prepMinutesForCount(objects.length);
  // Standard-Startzeit: aktuelle Uhrzeit + Vorbereitungszeit (auf 5 Min gerundet).
  // Die gewählte Startzeit ist die frühestmögliche Abfahrt.
  const resolvedStartTime = startTime ?? defaultStartTime(prepMinutes);
  const start = toMinutes(resolvedStartTime);
  const startSec = start * 60;

  const warehouseCoord = await geocodeAddress(WAREHOUSE_ADDRESS);
  const objectCoords = await Promise.all(
    objects.map((o) => geocodeAddress(o.address)),
  );
  const coords: Coordinate[] = [warehouseCoord, ...objectCoords];

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
  const hasOrsKey = Boolean(process.env.ORS_API_KEY);
  if (hasOrsKey && coords.length <= MAX_OPTIMIZATION_JOBS) {
    orsSolution = await solveWithOrsOptimization(
      coords,
      earliest,
      deadlineDirect,
      startSec,
    );

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
        const detourSolution = await solveWithOrsOptimization(
          detourCoords,
          earliest,
          deadlineDetour,
          startSec,
        );
        if (detourSolution) {
          orsSolution = detourSolution;
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
    mode = "openrouteservice";
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
      SERVICE_MINUTES,
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
          SERVICE_MINUTES,
        );
        if (solutionDetour.feasible) {
          finalMatrix = detour.matrix;
          finalDeadline = deadlineDetour;
          solution = solutionDetour;
          mode = detour.mode;
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
      SERVICE_MINUTES,
      true,
    ) ?? scheduleTimes(
      order,
      finalMatrix,
      earliest,
      finalDeadline,
      start,
      SERVICE_MINUTES,
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
    return {
      object_id: obj.id,
      name: obj.name,
      address: obj.address,
      arrival: formatMinutes(arrival),
      departure: formatMinutes(arrival + SERVICE_MINUTES),
      is_pedestrian_zone_until_11: obj.is_pedestrian_zone_until_11,
      key_number: obj.key_number,
      opens_at: obj.opens_at,
      approach_by_foot: walking !== undefined,
      walking_distance_m: walking ?? null,
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
  };
}
