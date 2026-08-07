/**
 * offlineFetch – Ersatz für `fetch` in den Daten-Komponenten
 * (siehe OFFLINE_SYNC_PLAN.md, Schritt 5).
 *
 * Verhalten:
 * - **Online:** Der Request läuft normal an den Server. Für „getrackte"
 *   Mutationen wird automatisch `client_updated_at` (server-ausgerichtet)
 *   angehängt (LWW-Schutz). Erfolgreiche Antworten (und 409-Konflikte)
 *   aktualisieren den lokalen IndexedDB-Cache.
 * - **Offline:** Getrackte Mutationen werden per `queueMutation` in die
 *   Offline-Queue gelegt (Sync beim Reconnect). Getrackte GETs werden aus
 *   dem Cache zusammengebaut („Offline-Read-Assembler"). Alles andere
 *   (Auth, Fotos, Geocoding, Löschen) antwortet mit 503.
 *
 * Das zurückgegebene Objekt ist fetch-kompatibel (ok/status/json()).
 */

import type { SyncTable } from "@/lib/sync-tables";
import { parseDeliveredItems, parseDeliveryItems } from "@/lib/items";
import { deleteRecord, getAllRecords, getRecord, putRecord } from "./db";
import {
  getCurrentUserId,
  getCurrentUserRole,
  getSyncState,
  ingestServerRecord,
  newRecordId,
  queueMutation,
} from "./sync";
import { nowServerAligned } from "./clock";

/* ------------------------------------------------------------------ */
/* Kleines fetch-kompatibles Response-Objekt                          */
/* ------------------------------------------------------------------ */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/* ------------------------------------------------------------------ */
/* Endpoint-Mapping                                                    */
/* ------------------------------------------------------------------ */

type OfflineRead = {
  kind: "read";
  path: string;
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
};

type OfflineQueue = {
  kind: "queue";
  path: string;
  method: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
};

/** Endpunkte, deren Antworten in den IndexedDB-Stores zwischengespeichert werden. */
const CACHEABLE_GETS: ReadonlyArray<{
  pattern: RegExp;
  tables: SyncTable[];
}> = [
  { pattern: /^\/api\/objects$/, tables: ["objects", "object_items"] },
  { pattern: /^\/api\/objects\/[^/]+$/, tables: ["objects", "object_items"] },
  { pattern: /^\/api\/objects\/[^/]+\/items$/, tables: ["object_items"] },
  { pattern: /^\/api\/objects\/[^/]+\/pack-info$/, tables: ["object_items"] },
  { pattern: /^\/api\/inventory$/, tables: ["inventory_items"] },
  { pattern: /^\/api\/planning$/, tables: ["objects", "weekly_default_routes"] },
  { pattern: /^\/api\/tours$/, tables: ["active_tours"] },
  { pattern: /^\/api\/tours\/[^/]+$/, tables: ["active_tours", "tour_stops", "objects"] },
  { pattern: /^\/api\/auth\/users$/, tables: ["profiles"] },
  { pattern: /^\/api\/time-tracking\/clock$/, tables: ["time_entries"] },
  { pattern: /^\/api\/time-tracking\/entries$/, tables: ["time_entries"] },
  { pattern: /^\/api\/time-tracking\/requests$/, tables: ["time_off_requests"] },
  { pattern: /^\/api\/time-tracking\/summary$/, tables: ["profiles", "time_entries", "time_off_requests"] },
  { pattern: /^\/api\/admin\/time-tracking\/overview$/, tables: ["profiles", "time_entries", "time_off_requests"] },
  { pattern: /^\/api\/admin\/time-tracking\/status$/, tables: ["profiles", "time_entries"] },
];

const OBJECT_FIELDS = [
  "name",
  "address",
  "latitude",
  "longitude",
  "category",
  "is_pedestrian_zone_until_11",
  "key_number",
  "opens_at",
  "customer",
  "customer_number",
  "cleaning_interval",
  "remark",
] as const;

const ITEM_FIELDS = [
  "object_id",
  "item_name",
  "quantity",
  "note",
  "photo_path",
  "is_always_required",
  "is_reserved",
] as const;

const INVENTORY_FIELDS = ["name", "note"] as const;
const TIME_ENTRY_FIELDS = [
  "user_id",
  "clock_in",
  "clock_out",
  "break_duration_minutes",
  "note",
  "is_approved",
] as const;
const TIME_OFF_FIELDS = [
  "user_id",
  "type",
  "start_date",
  "end_date",
  "status",
  "reviewer_note",
  "employee_note",
] as const;

function pick(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body === "string") {
    try {
      const parsed = JSON.parse(init.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* kein JSON-Body */
    }
  }
  return {};
}

/** Objekt-Felder aus einem Formular-Payload (inkl. Items-Liste). */
function objectPayload(body: Record<string, unknown>): Record<string, unknown> {
  return pick(body, OBJECT_FIELDS as readonly string[]);
}

/**
 * Entfernt eingebettete `profiles`-Referenzen aus API-Zeilen, bevor sie in
 * den IndexedDB-Store geschrieben werden (die Namen werden beim Offline-Read
 * aus dem profiles-Store rekonstruiert – keine verschachtelten Objekte cachen).
 */
function stripProfiles(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const { profiles: _profiles, ...rest } = row;
    return rest;
  });
}

/** Baut ein id → {name, role}-Mapping aus dem gecachten profiles-Store. */
async function profileRefsFromCache(): Promise<
  Map<string, { name?: string; role?: string }>
> {
  const profiles = await cacheRowsOf("profiles");
  const map = new Map<string, { name?: string; role?: string }>();
  for (const profile of profiles) {
    map.set(String(profile.id), {
      name: typeof profile.name === "string" ? profile.name : undefined,
      role: typeof profile.role === "string" ? profile.role : undefined,
    });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Cache-Logik                                                         */
/* ------------------------------------------------------------------ */

/** Hinterlegt Zeilen im Store; partielle Zeilen werden mit dem Bestand gemergt. */
async function cacheRows(
  table: SyncTable,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) continue;
    const existing = await getRecord(table, row.id);
    // Lokale pending-Bearbeitung gewinnt (wird beim Sync aufgelöst)
    if (existing?.sync_status === "pending_upload") continue;
    const merged = { ...(existing?.data ?? {}), ...row };
    await putRecord(table, {
      id: row.id,
      client_updated_at:
        typeof row.client_updated_at === "string"
          ? row.client_updated_at
          : existing?.client_updated_at ?? new Date().toISOString(),
      sync_status: "synced",
      data: merged,
    });
  }
}

/** Alle Zeilen einer Tabelle aus dem Cache (Daten, `id` garantiert enthalten). */
async function cacheRowsOf(table: SyncTable): Promise<Record<string, unknown>[]> {
  const records = await getAllRecords(table);
  return records.map((record) => ({ ...record.data, id: record.id }));
}

/**
 * Zugewiesene Objekt-IDs der aktuellen Reinigungskraft aus localStorage
 * (leer, wenn keine gespeichert sind – dann darf nichts offline gelesen
 * werden, siehe Filter in readOffline).
 */
function cachedAssignedObjectIds(): string[] {
  if (getCurrentUserRole() !== "facility_manager") return [];
  const userId = getCurrentUserId();
  try {
    const raw = window.localStorage.getItem(
      `thiel-assigned-objects:${userId ?? "anonymous"}`,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/** Prüft, ob die aktuelle Reinigungskraft ein Objekt offline sehen darf. */
function mayReadObjectOffline(objectId: string): boolean {
  if (getCurrentUserRole() !== "facility_manager") return true;
  const assigned = cachedAssignedObjectIds();
  if (assigned.length === 0) return false;
  return assigned.includes(objectId);
}

/** Speichert die Daten einer erfolgreichen Online-GET-Antwort. */
async function cacheResponse(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const userId = getCurrentUserId();
  if (path === "/api/objects") {
    const objects = Array.isArray(body.objects) ? body.objects : [];
    // Reinigungskraft: Zuweisungsliste merken, damit der Offline-Read-Assembler
    // nur zugewiesene Objekte liefert (auch wenn im Cache fremde Objekte
    // liegen, z. B. vom Admin-Konto auf demselben Gerät).
    if (
      getCurrentUserRole() === "facility_manager" &&
      Array.isArray(body.assigned_object_ids)
    ) {
      try {
        window.localStorage.setItem(
          `thiel-assigned-objects:${userId ?? "anonymous"}`,
          JSON.stringify(body.assigned_object_ids),
        );
      } catch {
        /* localStorage voll – Filter fällt auf alle Objekte zurück */
      }
    }
    const items: Array<Record<string, unknown>> = [];
    for (const obj of objects as Array<Record<string, unknown>>) {
      const embedded = Array.isArray(obj.object_items)
        ? (obj.object_items as Array<Record<string, unknown>>)
        : [];
      items.push(...embedded);
      delete obj.object_items;
    }
    await cacheRows("objects", objects as Array<Record<string, unknown>>);
    await cacheRows("object_items", items);
    return;
  }
  if (/^\/api\/objects\/[^/]+$/.test(path)) {
    const obj = (body.object ?? {}) as Record<string, unknown>;
    const embedded = Array.isArray(obj.object_items)
      ? (obj.object_items as Array<Record<string, unknown>>)
      : [];
    const clean = { ...obj };
    delete clean.object_items;
    await cacheRows("objects", [clean]);
    await cacheRows("object_items", embedded);
    return;
  }
  if (/^\/api\/objects\/[^/]+\/items$/.test(path)) {
    await cacheRows(
      "object_items",
      (Array.isArray(body.items) ? body.items : []) as Array<Record<string, unknown>>,
    );
    return;
  }
  if (/^\/api\/objects\/[^/]+\/pack-info$/.test(path)) {
    await cacheRows(
      "object_items",
      (Array.isArray(body.items) ? body.items : []) as Array<Record<string, unknown>>,
    );
    return;
  }
  if (path === "/api/inventory") {
    await cacheRows(
      "inventory_items",
      (Array.isArray(body.items) ? body.items : []) as Array<Record<string, unknown>>,
    );
    return;
  }
  if (path === "/api/planning") {
    const objects = (Array.isArray(body.objects) ? body.objects : []) as Array<
      Record<string, unknown>
    >;
    await cacheRows("objects", objects);
    const day = body.day_of_week;
    const selected = (Array.isArray(body.selected_ids)
      ? body.selected_ids
      : []) as string[];
    const baseTs =
      typeof body.defaults_updated_at === "string"
        ? body.defaults_updated_at
        : new Date().toISOString();
    await cacheRows(
      "weekly_default_routes",
      selected.map((objectId, index) => ({
        id: `wdr-${String(day)}-${objectId}`,
        user_id: userId ?? null,
        day_of_week: day,
        object_id: objectId,
        selection_order: index,
        client_updated_at: baseTs,
      })),
    );
    return;
  }
  if (path === "/api/tours") {
    // Nur Tabellen-Spalten cachen (keine History-Anreicherungsfelder)
    const rows = (Array.isArray(body.tours) ? body.tours : []).map((t) => {
      const tour = t as Record<string, unknown>;
      return {
        id: tour.id,
        date: tour.date,
        status: tour.status,
        start_time: tour.start_time,
        driver_name: tour.driver_name,
        created_at: tour.created_at,
        key_numbers: tour.key_numbers,
      };
    });
    await cacheRows("active_tours", rows);
    return;
  }
  if (/^\/api\/tours\/[^/]+$/.test(path)) {
    const tour = (body.tour ?? {}) as Record<string, unknown>;
    const stops = Array.isArray(tour.tour_stops)
      ? (tour.tour_stops as Array<Record<string, unknown>>)
      : [];
    const cleanTour = { ...tour };
    delete cleanTour.tour_stops;
    delete cleanTour.warehouse;
    await cacheRows("active_tours", [cleanTour]);
    // Eingebettete Objekt-Daten der Stopps (partiell) in den Objekt-Cache mergen
    const objectRows: Array<Record<string, unknown>> = [];
    const stopRows: Array<Record<string, unknown>> = [];
    for (const stop of stops) {
      const obj = (stop.object ?? {}) as Record<string, unknown>;
      if (obj.id) objectRows.push(obj);
      const cleanStop = { ...stop };
      delete cleanStop.object;
      stopRows.push(cleanStop);
    }
    await cacheRows("tour_stops", stopRows);
    await cacheRows("objects", objectRows);
    return;
  }
  if (path === "/api/auth/users") {
    await cacheRows(
      "profiles",
      (Array.isArray(body.users) ? body.users : []) as Array<Record<string, unknown>>,
    );
    return;
  }
  if (path === "/api/time-tracking/clock") {
    const entry = body.entry;
    if (entry && typeof entry === "object") {
      await cacheRows("time_entries", [entry as Record<string, unknown>]);
    } else if (entry === null) {
      const userId = getCurrentUserId();
      const cached = await getAllRecords("time_entries");
      for (const record of cached) {
        if (record.data.user_id === userId && record.data.clock_out == null) {
          await deleteRecord("time_entries", record.id);
        }
      }
    }
    return;
  }
  if (path === "/api/time-tracking/entries") {
    await cacheRows(
      "time_entries",
      stripProfiles((Array.isArray(body.entries) ? body.entries : []) as Array<Record<string, unknown>>),
    );
    return;
  }
  if (path === "/api/time-tracking/requests") {
    await cacheRows(
      "time_off_requests",
      stripProfiles((Array.isArray(body.requests) ? body.requests : []) as Array<Record<string, unknown>>),
    );
    return;
  }
  if (path === "/api/time-tracking/summary" || path === "/api/admin/time-tracking/overview") {
    const profiles = body.profile && typeof body.profile === "object"
      ? [body.profile as Record<string, unknown>]
      : (Array.isArray(body.employees) ? body.employees : []) as Array<Record<string, unknown>>;
    await cacheRows("profiles", profiles);
    await cacheRows("time_entries", stripProfiles((Array.isArray(body.entries) ? body.entries : []) as Array<Record<string, unknown>>));
    await cacheRows("time_off_requests", stripProfiles((Array.isArray(body.requests) ? body.requests : []) as Array<Record<string, unknown>>));
    return;
  }
  if (path === "/api/admin/time-tracking/status") {
    const employees = (Array.isArray(body.employees) ? body.employees : []) as Array<Record<string, unknown>>;
    await cacheRows("profiles", employees);
    await cacheRows(
      "time_entries",
      employees
        .map((employee) => employee.current_entry)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Offline-Read-Assembler                                              */
/* ------------------------------------------------------------------ */

async function readOffline(req: OfflineRead): Promise<Response> {
  const { path, params, query } = req;

  if (path === "/api/objects") {
    let objects = await cacheRowsOf("objects");
    // Reinigungskraft: offline nur zugewiesene Objekte ausliefern.
    if (getCurrentUserRole() === "facility_manager") {
      const assignedIds = cachedAssignedObjectIds();
      if (assignedIds.length > 0) {
        const assigned = new Set(assignedIds);
        objects = objects.filter((o) => assigned.has(String(o.id)));
      } else {
        objects = [];
      }
    }
    const items = await cacheRowsOf("object_items");
    const itemsByObject = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
      const key = typeof item.object_id === "string" ? item.object_id : "";
      if (!key) continue;
      const list = itemsByObject.get(key) ?? [];
      list.push(item);
      itemsByObject.set(key, list);
    }
    return jsonResponse(200, {
      objects: objects.map((obj) => ({
        ...obj,
        object_items: itemsByObject.get(String(obj.id)) ?? [],
      })),
    });
  }

  if (/^\/api\/objects\/[^/]+$/.test(path)) {
    const id = params.id;
    if (!mayReadObjectOffline(id)) {
      return jsonResponse(404, { error: "Objekt nicht gefunden." });
    }
    const obj = (await cacheRowsOf("objects")).find((row) => row.id === id);
    if (!obj) {
      return jsonResponse(404, { error: "Objekt nicht gefunden." });
    }
    const items = (await cacheRowsOf("object_items")).filter(
      (row) => row.object_id === id,
    );
    return jsonResponse(200, { object: { ...obj, object_items: items } });
  }

  if (/^\/api\/objects\/[^/]+\/items$/.test(path)) {
    const id = params.id;
    if (!mayReadObjectOffline(id)) {
      return jsonResponse(404, { error: "Objekt nicht gefunden." });
    }
    const items = (await cacheRowsOf("object_items")).filter(
      (row) => row.object_id === id,
    );
    return jsonResponse(200, { items });
  }

  if (/^\/api\/objects\/[^/]+\/pack-info$/.test(path)) {
    const id = params.id;
    if (!mayReadObjectOffline(id)) {
      return jsonResponse(404, { error: "Objekt nicht gefunden." });
    }
    const items = (await cacheRowsOf("object_items")).filter(
      (row) => row.object_id === id,
    );
    // Letzte Vormerkung für dieses Objekt aus den gecachten Tour-Stopps
    const excludedTour = req.query.get("exclude_tour");
    const stops = (await cacheRowsOf("tour_stops"))
      .filter(
        (row) =>
          row.object_id === id &&
          (!excludedTour || row.tour_id !== excludedTour),
      )
      .sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
      );
    const previousExtras = parseDeliveryItems(stops[0]?.next_delivery_items);
    return jsonResponse(200, { items, previous_extras: previousExtras });
  }

  if (path === "/api/inventory") {
    const items = await cacheRowsOf("inventory_items");
    return jsonResponse(200, { items });
  }

  if (path === "/api/planning") {
    const day = Number.parseInt(req.query.get("day_of_week") ?? "", 10);
    const userId = getCurrentUserId();
    const objects = (await cacheRowsOf("objects")).map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      category: row.category,
      is_pedestrian_zone_until_11: row.is_pedestrian_zone_until_11,
      opens_at: row.opens_at,
      remark: row.remark,
    }));
    const defaults = (await cacheRowsOf("weekly_default_routes"))
      .filter(
        (row) =>
          Number(row.day_of_week) === day &&
          (userId === null || row.user_id === userId),
      )
      .sort((a, b) => Number(a.selection_order) - Number(b.selection_order));
    const selectedIds = defaults
      .map((row) => row.object_id)
      .filter((id): id is string => typeof id === "string");
    const updatedAtValues = defaults
      .map((row) => row.client_updated_at)
      .filter((value): value is string => typeof value === "string")
      .map((value) => new Date(value).getTime());
    return jsonResponse(200, {
      day_of_week: Number.isNaN(day) ? 1 : day,
      objects,
      selected_ids: selectedIds,
      defaults_updated_at:
        updatedAtValues.length > 0
          ? new Date(Math.max(...updatedAtValues)).toISOString()
          : null,
    });
  }

  if (path === "/api/tours") {
    const tours = (await cacheRowsOf("active_tours")).sort((a, b) => {
      const dateCmp = String(b.date ?? "").localeCompare(String(a.date ?? ""));
      if (dateCmp !== 0) return dateCmp;
      return String(b.created_at ?? "").localeCompare(
        String(a.created_at ?? ""),
      );
    });
    const stops = await cacheRowsOf("tour_stops");
    const objects = await cacheRowsOf("objects");
    const profiles = await cacheRowsOf("profiles");
    const objectName = new Map(objects.map((o) => [o.id, o.name]));
    const driverName = new Map(profiles.map((p) => [p.id, p.name]));
    const history = tours.map((tour) => {
      const tourStops = stops
        .filter((s) => s.tour_id === tour.id)
        .sort((a, b) => Number(a.stop_order) - Number(b.stop_order));
      const delivered = tourStops.filter((s) => s.is_delivered === true);
      return {
        id: tour.id,
        date: tour.date,
        status: tour.status,
        start_time: tour.start_time,
        driver_name:
          typeof tour.driver_name === "string"
            ? tour.driver_name
            : typeof tour.driver_id === "string"
              ? (driverName.get(tour.driver_id) as string | undefined) ?? null
              : null,
        delivered_objects: delivered
          .map((s) => objectName.get(s.object_id as string))
          .filter((n): n is string => typeof n === "string"),
        delivered_count: delivered.length,
        key_numbers: [...new Set(
          tourStops
            .map((s) => s.key_number)
            .filter((key): key is number => typeof key === "number"),
        )].sort((a, b) => a - b),
        total_stops: tourStops.length,
      };
    });
    return jsonResponse(200, { tours: history });
  }

  if (/^\/api\/tours\/[^/]+$/.test(path)) {
    const id = params.id;
    const tour = (await cacheRowsOf("active_tours")).find((row) => row.id === id);
    if (!tour) {
      return jsonResponse(404, { error: "Tour nicht gefunden." });
    }
    const stops = (await cacheRowsOf("tour_stops"))
      .filter((row) => row.tour_id === id)
      .sort((a, b) => Number(a.stop_order) - Number(b.stop_order));
    const objects = await cacheRowsOf("objects");
    const objectById = new Map(objects.map((o) => [o.id, o]));
    const tourStops = stops.map((stop) => {
      const obj = objectById.get(stop.object_id as string) ?? {};
      return {
        id: stop.id,
        stop_order: stop.stop_order,
        arrival_time: stop.arrival_time,
        is_delivered: stop.is_delivered === true,
        key_number: typeof stop.key_number === "number" ? stop.key_number : null,
        next_delivery_items: parseDeliveryItems(stop.next_delivery_items),
        delivered_items: parseDeliveredItems(stop.delivered_items),
        object: {
          id: stop.object_id,
          name: obj.name ?? "Unbekanntes Objekt",
          address: obj.address ?? "",
          category: obj.category ?? "objekt",
          latitude: obj.latitude ?? null,
          longitude: obj.longitude ?? null,
          remark: obj.remark ?? null,
        },
      };
    });
    return jsonResponse(200, {
      tour: { ...tour, tour_stops: tourStops, warehouse: null },
    });
  }

  if (path === "/api/auth/users") {
    const users = await cacheRowsOf("profiles");
    return jsonResponse(200, { users });
  }

  if (path === "/api/time-tracking/clock") {
    const userId = getCurrentUserId();
    const entry = (await cacheRowsOf("time_entries"))
      .filter((row) => row.user_id === userId && row.clock_out == null)
      .sort((a, b) => String(b.clock_in ?? "").localeCompare(String(a.clock_in ?? "")))[0] ?? null;
    return jsonResponse(200, { entry });
  }

  if (path === "/api/time-tracking/entries") {
    const userId = getCurrentUserId();
    const all = await cacheRowsOf("time_entries");
    const rows = all.filter((row) => userId === null || row.user_id === userId);
    const profileById = await profileRefsFromCache();
    return jsonResponse(200, {
      entries: rows.map((row) => ({
        ...row,
        profiles: profileById.get(String(row.user_id)) ?? null,
      })),
    });
  }

  if (path === "/api/time-tracking/requests") {
    const rows = await cacheRowsOf("time_off_requests");
    const profileById = await profileRefsFromCache();
    return jsonResponse(200, {
      requests: rows.map((row) => ({
        ...row,
        profiles: profileById.get(String(row.user_id)) ?? null,
      })),
    });
  }

  if (path === "/api/time-tracking/summary") {
    const userId = getCurrentUserId();
    const profile = (await cacheRowsOf("profiles")).find((row) => row.id === userId) ?? null;
    const entries = (await cacheRowsOf("time_entries")).filter((row) => userId === null || row.user_id === userId);
    const requests = (await cacheRowsOf("time_off_requests")).filter((row) => userId === null || row.user_id === userId);
    return jsonResponse(200, { profile, entries, requests });
  }

  if (path === "/api/admin/time-tracking/overview") {
    const role = query.get("role");
    const search = (query.get("q") ?? "").trim().toLowerCase();
    const profiles = (await cacheRowsOf("profiles")).filter((profile) => {
      const roleMatches = !role || profile.role === role;
      const searchMatches = !search || String(profile.name ?? "").toLowerCase().includes(search) || String(profile.email ?? "").toLowerCase().includes(search);
      return roleMatches && searchMatches;
    });
    const selectedIds = new Set(profiles.map((profile) => profile.id));
    const profileRefById = new Map(
      profiles.map((profile) => [String(profile.id), { name: typeof profile.name === "string" ? profile.name : undefined, role: typeof profile.role === "string" ? profile.role : undefined }]),
    );
    const entries: Array<Record<string, unknown>> = (await cacheRowsOf("time_entries"))
      .filter((entry) => selectedIds.has(entry.user_id as string))
      .map((entry) => ({ ...entry, profiles: profileRefById.get(String(entry.user_id)) ?? null }));
    const requests: Array<Record<string, unknown>> = (await cacheRowsOf("time_off_requests"))
      .filter((request) => selectedIds.has(request.user_id as string))
      .map((request) => ({ ...request, profiles: profileRefById.get(String(request.user_id)) ?? null }));
    const openByUser = new Map(entries.filter((entry) => entry.clock_out == null).map((entry) => [entry.user_id, entry]));
    // Aktive Tour + nächstes nicht beliefertes Objekt aus dem Cache rekonstruieren
    // (analog zur Online-Übersicht), damit der Status auch offline vollständig ist.
    const tours = (await cacheRowsOf("active_tours")).filter((tour) => tour.status === "in_transit");
    const stops = await cacheRowsOf("tour_stops");
    const objects = await cacheRowsOf("objects");
    const objectName = new Map<string, string>();
    for (const object of objects) {
      const objectId = typeof object.id === "string" ? object.id : "";
      const objectLabel = typeof object.name === "string" ? object.name : "";
      if (objectId) objectName.set(objectId, objectLabel);
    }
    const assignmentByDriver = new Map<string, { tour_id: string; tour_date: string; object_name: string | null }>();
    for (const tour of tours) {
      const driverId = typeof tour.driver_id === "string" ? tour.driver_id : null;
      if (!driverId) continue;
      const tourId = typeof tour.id === "string" ? tour.id : "";
      const nextStop = stops
        .filter((stop) => stop.tour_id === tourId && stop.is_delivered !== true)
        .sort((a, b) => Number(a.stop_order) - Number(b.stop_order))[0];
      const stopObjectId: string | null =
        nextStop && typeof nextStop.object_id === "string" ? nextStop.object_id : null;
      assignmentByDriver.set(driverId, {
        tour_id: tourId,
        tour_date: String(tour.date ?? ""),
        object_name: stopObjectId ? objectName.get(stopObjectId) ?? null : null,
      });
    }
    return jsonResponse(200, {
      employees: profiles.map((profile) => {
        const profileId = typeof profile.id === "string" ? profile.id : "";
        return {
          ...profile,
          current_entry: openByUser.get(profileId) ?? null,
          current_assignment: assignmentByDriver.get(profileId) ?? null,
        };
      }),
      entries,
      requests,
    });
  }

  if (path === "/api/admin/time-tracking/status") {
    const profiles = await cacheRowsOf("profiles");
    const entries = await cacheRowsOf("time_entries");
    const openByUser = new Map(entries.filter((entry) => entry.clock_out == null).map((entry) => [entry.user_id, entry]));
    return jsonResponse(200, {
      employees: profiles.map((profile) => ({ ...profile, current_entry: openByUser.get(profile.id) ?? null })),
    });
  }

  return jsonResponse(503, { error: "Diese Seite ist offline nicht verfügbar." });
}

/* ------------------------------------------------------------------ */
/* Offline-Queue (Mutationen)                                          */
/* ------------------------------------------------------------------ */

async function queueOffline(req: OfflineQueue): Promise<Response> {
  const { path, method, params, body } = req;

  // POST /api/objects – Objekt + Items anlegen
  if (path === "/api/objects" && method === "POST") {
    const id = newRecordId();
    await queueMutation("objects", id, objectPayload(body));
    const items = Array.isArray(body.items) ? body.items : [];
    for (const raw of items as Array<Record<string, unknown>>) {
      await queueMutation("object_items", newRecordId(), {
        ...pick(raw, ITEM_FIELDS as readonly string[]),
        object_id: id,
      });
    }
    return jsonResponse(201, { object: { id } });
  }

  // PUT /api/objects/[id] – Objekt-Felder + Item-Upserts (nach Name)
  if (/^\/api\/objects\/[^/]+$/.test(path) && method === "PUT") {
    const id = params.id;
    await queueMutation("objects", id, objectPayload(body));
    const items = Array.isArray(body.items) ? body.items : [];
    const existingItems = (await cacheRowsOf("object_items")).filter(
      (row) => row.object_id === id,
    );
    for (const raw of items as Array<Record<string, unknown>>) {
      const name = typeof raw.item_name === "string" ? raw.item_name : "";
      const existing = existingItems.find((row) => row.item_name === name);
      await queueMutation("object_items", existing?.id as string | undefined ?? newRecordId(), {
        ...pick(raw, ITEM_FIELDS as readonly string[]),
        object_id: id,
      });
    }
    return jsonResponse(200, { object: { id } });
  }

  // POST /api/objects/[id]/items
  if (/^\/api\/objects\/[^/]+\/items$/.test(path) && method === "POST") {
    await queueMutation("object_items", newRecordId(), {
      ...pick(body, ITEM_FIELDS as readonly string[]),
      object_id: params.id,
    });
    return jsonResponse(201, { item: {} });
  }

  // PUT /api/objects/[id]/items/[itemId]
  if (/^\/api\/objects\/[^/]+\/items\/[^/]+$/.test(path) && method === "PUT") {
    await queueMutation("object_items", params.itemId, {
      ...pick(body, ITEM_FIELDS as readonly string[]),
      object_id: params.id,
    });
    return jsonResponse(200, { item: { id: params.itemId } });
  }

  // POST /api/inventory
  if (path === "/api/inventory" && method === "POST") {
    const id = newRecordId();
    await queueMutation("inventory_items", id, pick(body, INVENTORY_FIELDS as readonly string[]));
    return jsonResponse(201, { item: { id } });
  }

  // PUT /api/inventory/[id]
  if (/^\/api\/inventory\/[^/]+$/.test(path) && method === "PUT") {
    await queueMutation("inventory_items", params.id, pick(body, INVENTORY_FIELDS as readonly string[]));
    return jsonResponse(200, { item: { id: params.id } });
  }

  // POST /api/tours – Tour + Stopps anlegen (Client-UUIDs, Sync über /api/sync)
  if (path === "/api/tours" && method === "POST") {
    const id = newRecordId();
    const today = new Date().toISOString().slice(0, 10);
    await queueMutation("active_tours", id, {
      date: today,
      status: typeof body.status === "string" ? body.status : "packing",
      start_time: typeof body.start_time === "string" ? body.start_time : null,
    });
    const stops = Array.isArray(body.stops) ? body.stops : [];
    for (const [index, raw] of (stops as Array<Record<string, unknown>>).entries()) {
      await queueMutation("tour_stops", newRecordId(), {
        tour_id: id,
        object_id: typeof raw.object_id === "string" ? raw.object_id : "",
        stop_order: index,
        arrival_time: typeof raw.arrival_time === "string" ? raw.arrival_time : null,
        is_delivered: false,
        key_number: typeof raw.key_number === "number" ? raw.key_number : null,
        next_delivery_items: null,
      });
    }
    return jsonResponse(201, { tour: { id } });
  }

  // PATCH /api/tours/[id]
  if (/^\/api\/tours\/[^/]+$/.test(path) && method === "PATCH") {
    await queueMutation("active_tours", params.id, pick(body, [
      "driver_id",
      "date",
      "status",
      "start_time",
      "total_duration_minutes",
    ]));
    return jsonResponse(200, { tour: { id: params.id } });
  }

  // PATCH /api/tours/[id]/stops/[stopId]
  if (/^\/api\/tours\/[^/]+\/stops\/[^/]+$/.test(path) && method === "PATCH") {
    await queueMutation("tour_stops", params.stopId, pick(body, [
      "stop_order",
      "arrival_time",
      "is_delivered",
      "next_delivery_items",
      "delivered_items",
    ]));
    return jsonResponse(200, { stop: { id: params.stopId } });
  }

  // PATCH /api/auth/me-profile – nur Name offline syncbar (Username = E-Mail)
  if (path === "/api/auth/me-profile" && method === "PATCH") {
    if (body.username !== undefined) {
      return jsonResponse(503, {
        error: "Benutzername-Änderungen sind offline nicht möglich.",
      });
    }
    const userId = getCurrentUserId();
    if (!userId) {
      return jsonResponse(503, {
        error: "Profil-Änderungen sind offline nicht möglich.",
      });
    }
    await queueMutation("profiles", userId, pick(body, ["name", "role"]));
    return jsonResponse(200, { user: { id: userId } });
  }

  // PATCH /api/auth/users/[id] (Admin) – inkl. Vertragsart & Kontokorrektur
  if (/^\/api\/auth\/users\/[^/]+$/.test(path) && method === "PATCH") {
    await queueMutation("profiles", params.id, pick(body, [
      "name",
      "role",
      "contract_type",
      "vacation_days_total",
      "overtime_hours",
    ]));
    return jsonResponse(200, { user: { id: params.id } });
  }

  // POST /api/time-tracking/entries – „Arbeitszeit nachreichen“ (offline queuen)
  if (path === "/api/time-tracking/entries" && method === "POST") {
    const id = newRecordId();
    await queueMutation("time_entries", id, {
      ...pick(body, TIME_ENTRY_FIELDS as readonly string[]),
      user_id: getCurrentUserId(),
      is_approved: false,
    });
    return jsonResponse(201, { entry: { id } });
  }

  // Zeiterfassung: Online bleibt die Clock-Route autoritativ; bei einem
  // Netzwerkausfall werden Creates/Updates direkt im Sync-Store gehalten.
  if (path === "/api/time-tracking/clock" && method === "POST") {
    const action = body.action;
    const entries = await cacheRowsOf("time_entries");
    const currentUserId = getCurrentUserId();
    const open = entries.find((entry) => entry.user_id === currentUserId && entry.clock_out == null);
    const eventAt = typeof body.event_at === "string" ? body.event_at : nowServerAligned();
    if (action === "clock_in") {
      if (open) return jsonResponse(200, { entry: open });
      const id = newRecordId();
      await queueMutation("time_entries", id, {
        user_id: currentUserId,
        clock_in: eventAt,
        clock_out: null,
        break_duration_minutes: 0,
        note: null,
        is_approved: true,
      });
      return jsonResponse(201, { entry: { id, user_id: currentUserId, clock_in: eventAt, clock_out: null, break_duration_minutes: 0, note: null, is_approved: true } });
    }
    if (action === "clock_out" && open && typeof open.id === "string") {
      const existing = await getRecord("time_entries", open.id);
      await queueMutation("time_entries", open.id, {
        ...(existing?.data ?? {}),
        ...pick(open as Record<string, unknown>, TIME_ENTRY_FIELDS as readonly string[]),
        clock_out: eventAt,
        break_duration_minutes: Number(body.break_duration_minutes) || 0,
      });
      return jsonResponse(200, { entry: { ...open, clock_out: eventAt, break_duration_minutes: Number(body.break_duration_minutes) || 0 } });
    }
    return jsonResponse(409, { error: "Keine offene Stempelung vorhanden." });
  }

  if (/^\/api\/time-tracking\/requests\/[^/]+$/.test(path) && method === "PATCH") {
    const existing = await getRecord("time_off_requests", params.id);
    await queueMutation("time_off_requests", params.id, {
      ...(existing?.data ?? {}),
      ...pick(body, ["type", "start_date", "end_date", "status", "reviewer_note", "employee_note"]),
    });
    return jsonResponse(200, { request: { ...(existing?.data ?? {}), id: params.id, status: body.status } });
  }

  if (/^\/api\/admin\/time-tracking\/entries\/[^/]+$/.test(path) && method === "PATCH") {
    const existing = await getRecord("time_entries", params.id);
    await queueMutation("time_entries", params.id, {
      ...(existing?.data ?? {}),
      is_approved: body.is_approved,
    });
    return jsonResponse(200, { entry: { ...(existing?.data ?? {}), id: params.id, is_approved: body.is_approved } });
  }

  if (path === "/api/time-tracking/requests" && method === "POST") {
    const id = newRecordId();
    await queueMutation("time_off_requests", id, {
      ...pick(body, TIME_OFF_FIELDS as readonly string[]),
      user_id: getCurrentUserId(),
      status: "pending",
    });
    return jsonResponse(201, { request: { id, ...pick(body, TIME_OFF_FIELDS as readonly string[]), status: "pending" } });
  }

  return jsonResponse(503, { error: "Diese Aktion ist offline nicht verfügbar." });
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function stripQuery(url: string): { path: string; query: URLSearchParams } {
  const [pathPart, queryPart = ""] = url.split("?");
  return { path: pathPart, query: new URLSearchParams(queryPart) };
}

function extractParams(path: string): Record<string, string> {
  const segments = path.split("/").filter(Boolean);
  const out: Record<string, string> = {};
  if (segments[0] === "api" && segments[1] === "time-tracking" && segments[2] === "requests" && segments[3]) {
    out.id = segments[3];
    return out;
  }
  if (segments[0] === "api" && segments[1] === "admin" && segments[2] === "time-tracking" && segments[3] === "entries" && segments[4]) {
    out.id = segments[4];
    return out;
  }
  if (segments[2]) out.id = segments[2];
  if (segments[4]) out.itemId = segments[4];
  if (segments[4]) out.stopId = segments[4];
  return out;
}

/** Gehört der Endpunkt zu den offline-queued Mutationen? */
function isQueueableMutation(path: string, method: string): boolean {
  if (method === "GET") return false;
  return (
    path === "/api/objects" ||
    /^\/api\/objects\/[^/]+$/.test(path) ||
    /^\/api\/objects\/[^/]+\/items$/.test(path) ||
    /^\/api\/objects\/[^/]+\/items\/[^/]+$/.test(path) ||
    path === "/api/inventory" ||
    /^\/api\/inventory\/[^/]+$/.test(path) ||
    path === "/api/tours" ||
    /^\/api\/tours\/[^/]+$/.test(path) ||
    /^\/api\/tours\/[^/]+\/stops\/[^/]+$/.test(path) ||
    path === "/api/auth/me-profile" ||
    /^\/api\/auth\/users\/[^/]+$/.test(path) ||
    path === "/api/time-tracking/clock" ||
    path === "/api/time-tracking/entries" ||
    path === "/api/time-tracking/requests" ||
    /^\/api\/time-tracking\/requests\/[^/]+$/.test(path) ||
    /^\/api\/admin\/time-tracking\/entries\/[^/]+$/.test(path)
  );
}

/** Ist der Endpunkt ein offline-lesbarer GET? */
function isReadableGet(path: string, method: string): boolean {
  if (method !== "GET") return false;
  return CACHEABLE_GETS.some((entry) => entry.pattern.test(path));
}

/* ------------------------------------------------------------------ */
/* Online-Pfad                                                         */
/* ------------------------------------------------------------------ */

/** Server-Key der Erfolgsantwort je Endpunkt (fürs Cache-Ingest). */
function serverKeyFor(path: string, method: string): string | null {
  if (method === "GET") return null;
  if (/^\/api\/objects$/.test(path)) return "object";
  if (/^\/api\/objects\/[^/]+$/.test(path)) return "object";
  if (/^\/api\/objects\/[^/]+\/items$/.test(path)) return "item";
  if (/^\/api\/objects\/[^/]+\/items\/[^/]+$/.test(path)) return "item";
  if (path === "/api/inventory") return "item";
  if (/^\/api\/inventory\/[^/]+$/.test(path)) return "item";
  if (path === "/api/tours") return "tour";
  if (/^\/api\/tours\/[^/]+$/.test(path)) return "tour";
  if (/^\/api\/tours\/[^/]+\/stops\/[^/]+$/.test(path)) return "stop";
  if (path === "/api/time-tracking/clock") return "entry";
  if (path === "/api/time-tracking/entries") return "entry";
  if (/^\/api\/time-tracking\/requests\/[^/]+$/.test(path)) return "request";
  if (/^\/api\/admin\/time-tracking\/entries\/[^/]+$/.test(path)) return "entry";
  return null; // auth: me-profile/users → Antwort ist kein Tabellen-Row
}

/** Tabelle für Konflikt-/Erfolgs-Ingest je Endpunkt. */
function tableFor(path: string, method: string): SyncTable | null {
  if (path.startsWith("/api/objects")) {
    if (/\/items\/[^/]+$/.test(path) || /\/items$/.test(path)) return "object_items";
    if (/\/pack-info$/.test(path)) return null;
    return "objects";
  }
  if (path.startsWith("/api/inventory")) return "inventory_items";
  if (/^\/api\/tours\/[^/]+\/stops\/[^/]+$/.test(path)) return "tour_stops";
  if (path.startsWith("/api/tours")) return "active_tours";
  if (path === "/api/auth/me-profile" || /^\/api\/auth\/users\/[^/]+$/.test(path)) {
    return "profiles";
  }
  if (path === "/api/time-tracking/clock" || path === "/api/time-tracking/entries" || /^\/api\/admin\/time-tracking\/entries\/[^/]+$/.test(path)) return "time_entries";
  if (path === "/api/time-tracking/requests" || /^\/api\/time-tracking\/requests\/[^/]+$/.test(path)) return "time_off_requests";
  return null;
}

async function forwardOnline(
  url: string,
  init: RequestInit | undefined,
  method: string,
  path: string,
): Promise<Response> {
  let res: Response;
  try {
    // Getrackte Mutationen: client_updated_at anhängen (LWW)
    if (isQueueableMutation(path, method)) {
      const body = parseBody(init);
      const withTimestamp = { ...body, client_updated_at: nowServerAligned() };
      res = await fetch(url, { ...init, body: JSON.stringify(withTimestamp) });
    } else {
      res = await fetch(url, init);
    }
  } catch {
    // Netzwerkfehler bei „scheinbar online“ (z. B. WLAN verbunden, aber kein
    // Internet durchkommt – navigator.onLine bleibt dann true): lesbare GETs
    // aus dem Cache bedienen, idempotente Updates (PUT/PATCH, per id + LWW
    // sicher wiederholbar) offline einreihen – sonst einheitliche 503.
    const { query } = stripQuery(url);
    const params = extractParams(path);
    if (isReadableGet(path, method)) {
      return readOffline({ kind: "read", path, method, params, query });
    }
    if (
      isQueueableMutation(path, method) &&
      (method === "PUT" || method === "PATCH")
    ) {
      return queueOffline({
        kind: "queue",
        path,
        method,
        params,
        body: parseBody(init),
      });
    }
    return jsonResponse(503, { error: "Keine Verbindung zum Server." });
  }

  if (method !== "GET") {
    const table = tableFor(path, method);
    if (table) {
      // Clone, damit der Original-Response-Body für den Aufrufer erhalten bleibt
      const clone = res.clone();
      const json = (await clone.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 409 && json.serverRecord) {
        await ingestServerRecord(table, json.serverRecord as Record<string, unknown>);
      } else if (res.ok) {
        const key = serverKeyFor(path, method);
        const record = key ? json[key] : null;
        if (record && typeof record === "object") {
          await ingestServerRecord(table, record as Record<string, unknown>);
        }
      }
    }
    return res;
  }

  // GET: Antwort cachen (für den Offline-Modus); Body per Clone lesen.
  // Fire-and-forget: Caching darf die Antwort nicht verzögern.
  if (res.ok) {
    const clone = res.clone();
    void clone
      .json()
      .catch(() => ({}))
      .then((json) => cacheResponse(path, json as Record<string, unknown>));
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Öffentlicher Einstieg                                                */
/* ------------------------------------------------------------------ */

/** fetch-Ersatz mit Offline-First-Verhalten. */
export async function offlineFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const { path, query } = stripQuery(url);

  // Offline?
  if (!getSyncState().online || typeof navigator !== "undefined" && !navigator.onLine) {
    if (isReadableGet(path, method)) {
      return readOffline({ kind: "read", path, method, params: extractParams(path), query });
    }
    if (isQueueableMutation(path, method)) {
      const body = parseBody(init);
      return queueOffline({ kind: "queue", path, method, params: extractParams(path), body });
    }
    // Online-only (Auth, Fotos, Geocoding, Löschen, Planning-Speichern)
    return jsonResponse(503, { error: "Diese Aktion ist offline nicht verfügbar." });
  }

  return forwardOnline(url, init, method, path);
}

/** Direkt einen Server-Datensatz in den Cache übernehmen (für Spezialfälle). */
export { ingestServerRecord };
