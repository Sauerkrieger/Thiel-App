import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CurrentUser } from "@/lib/auth";
import { isAdmin, isPlanner } from "@/lib/auth";
import { SYNC_TABLES, isSyncTable, type SyncTable } from "@/lib/sync-tables";

export { SYNC_TABLES, isSyncTable, type SyncTable } from "@/lib/sync-tables";

/**
 * LWW-Registry für den Offline-First-Sync (siehe OFFLINE_SYNC_PLAN.md).
 *
 * Grundidee: Jeder synchronisierbare Datensatz trägt ein `client_updated_at`
 * (Zeitpunkt der letzten Bearbeitung auf dem Gerät). Kommt ein Update mit
 * einem älteren `client_updated_at` an, wird es verworfen (Conflict ignored)
 * und der aktuelle Server-Zustand an den Client zurückgemeldet.
 *
 * Der Admin-Client umgeht RLS – deshalb sind hier pro Tabelle Whitelists
 * (welche Felder ein Client setzen darf) und Rollen-Checks hart kodiert.
 */


/**
 * Kleiner Typ für die von applyLww genutzten Supabase-Query-Methoden.
 * Der echte Builder-Typ ist generisch über den Tabellennamen; da der Name
 * hier dynamisch ist, wird die Query auf diese schlanke Schnittstelle gecastet.
 */
type SyncRow = Record<string, unknown>;

type SyncQuery = {
  select(columns: string): SyncSelect;
  update(payload: SyncRow): SyncUpdate;
  insert(payload: SyncRow): SyncInsert;
};

type SyncResult = { data: SyncRow | null; error: { message: string } | null };

type SyncFiltered = {
  eq(column: string, value: unknown): SyncFiltered;
  maybeSingle(): Promise<SyncResult>;
  single(): Promise<SyncResult>;
};

type SyncSelect = {
  eq(column: string, value: unknown): SyncFiltered;
};

type SyncUpdate = {
  eq(column: string, value: unknown): {
    select(columns: string): {
      single(): Promise<SyncResult>;
    };
  };
};

type SyncInsert = {
  select(columns: string): {
    single(): Promise<SyncResult>;
  };
};

/** Feld-Whitelists je Tabelle: Der Client darf NUR diese Felder über den Sync setzen. */
const FIELD_WHITELISTS: Record<SyncTable, readonly string[]> = {
  profiles: ["name", "role"],
  objects: [
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
  ],
  object_items: [
    "object_id",
    "item_name",
    "quantity",
    "note",
    "photo_path",
    "is_always_required",
  ],
  inventory_items: ["name", "note"],
  weekly_default_routes: ["day_of_week", "object_id", "selection_order"],
  active_tours: [
    "driver_id",
    "date",
    "status",
    "start_time",
    "total_duration_minutes",
  ],
  tour_stops: [
    "tour_id",
    "object_id",
    "stop_order",
    "arrival_time",
    "is_delivered",
    "next_delivery_items",
  ],
};

/** Validiert einen ISO-8601-Zeitstempel und normalisiert ihn auf ISO-UTC. */
export function parseClientUpdatedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/* ------------------------------------------------------------------ */
/* Daten-Validierung (der Sync-Endpoint umgeht die API-Routen –       */
/* deshalb müssen Typen/Bereiche/Enums auch hier geprüft werden)      */
/* ------------------------------------------------------------------ */

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FieldSpec =
  | { t: "text"; max: number }
  | { t: "number"; min: number; max: number; int?: boolean }
  | { t: "bool" }
  | { t: "enum"; values: readonly string[] }
  | { t: "hhmm" }
  | { t: "date" }
  | { t: "json" };

const TABLE_SPECS: Record<SyncTable, Record<string, FieldSpec>> = {
  profiles: {
    name: { t: "text", max: 200 },
    role: { t: "enum", values: ["driver", "admin", "facility_manager"] },
  },
  objects: {
    name: { t: "text", max: 200 },
    address: { t: "text", max: 300 },
    latitude: { t: "number", min: -90, max: 90 },
    longitude: { t: "number", min: -180, max: 180 },
    category: { t: "enum", values: ["objekt", "treppenhaus"] },
    is_pedestrian_zone_until_11: { t: "bool" },
    key_number: { t: "number", min: 1, max: 100000, int: true },
    opens_at: { t: "hhmm" },
    customer: { t: "text", max: 200 },
    customer_number: { t: "text", max: 100 },
    cleaning_interval: { t: "text", max: 100 },
    remark: { t: "text", max: 500 },
  },
  object_items: {
    object_id: { t: "text", max: 64 },
    item_name: { t: "text", max: 300 },
    quantity: { t: "number", min: 0, max: 100000, int: true },
    note: { t: "text", max: 500 },
    photo_path: { t: "text", max: 500 },
    is_always_required: { t: "bool" },
  },
  inventory_items: {
    name: { t: "text", max: 200 },
    note: { t: "text", max: 500 },
  },
  weekly_default_routes: {
    day_of_week: { t: "number", min: 0, max: 6, int: true },
    object_id: { t: "text", max: 64 },
    selection_order: { t: "number", min: 0, max: 100000, int: true },
  },
  active_tours: {
    driver_id: { t: "text", max: 64 },
    date: { t: "date" },
    status: { t: "enum", values: ["packing", "in_transit", "completed"] },
    start_time: { t: "hhmm" },
    total_duration_minutes: { t: "number", min: 0, max: 100000, int: true },
  },
  tour_stops: {
    tour_id: { t: "text", max: 64 },
    object_id: { t: "text", max: 64 },
    stop_order: { t: "number", min: 0, max: 100000, int: true },
    arrival_time: { t: "hhmm" },
    is_delivered: { t: "bool" },
    next_delivery_items: { t: "json" },
  },
};

/**
 * Bereinigt Sync-Daten anhand der Feld-Specs: ungültige Werte werden
 * verworfen, null bleibt null (nullable), Strings werden getrimmt.
 */
function sanitizeSyncData(
  table: SyncTable,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const specs = TABLE_SPECS[table];
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const spec = specs[key];
    if (!spec) continue;

    let out: unknown;
    switch (spec.t) {
      case "text": {
        if (value === null || value === undefined) {
          out = null;
          break;
        }
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        out = trimmed ? trimmed.slice(0, spec.max) : null;
        break;
      }
      case "number": {
        if (value === null || value === undefined) {
          out = null;
          break;
        }
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n) || n < spec.min || n > spec.max) continue;
        out = spec.int ? Math.round(n) : n;
        break;
      }
      case "bool": {
        if (typeof value !== "boolean") continue;
        out = value;
        break;
      }
      case "enum": {
        if (
          typeof value !== "string" ||
          !spec.values.includes(value)
        ) {
          continue;
        }
        out = value;
        break;
      }
      case "hhmm": {
        if (value === null || value === undefined) {
          out = null;
          break;
        }
        if (typeof value !== "string" || !HHMM_PATTERN.test(value)) continue;
        out = value;
        break;
      }
      case "date": {
        if (value === null || value === undefined) {
          out = null;
          break;
        }
        if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) continue;
        out = value;
        break;
      }
      case "json": {
        // next_delivery_items: JSON-Liste oder null
        if (value === null || value === undefined) {
          out = null;
          break;
        }
        if (!Array.isArray(value)) continue;
        out = value;
        break;
      }
    }
    if (out !== undefined) clean[key] = out;
  }
  return clean;
}

/** Vorbereiteter, validierter Eintrag. */
export type PreparedSyncEntry = {
  table: SyncTable;
  id: string;
  client_updated_at: string;
  data: Record<string, unknown>;
};

/**
 * Validiert einen Sync-Eintrag gegen Rollen + Feld-Whitelist und bereitet
 * ihn für applyLww vor. Liefert bei Erfolg die bereinigten Daten (inkl.
 * erzwungener Felder wie user_id/driver_id), sonst eine Fehlermeldung.
 */
export function prepareSyncEntry(
  user: CurrentUser,
  entry: unknown,
): { ok: true; prepared: PreparedSyncEntry } | { ok: false; error: string } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: "Ungültiger Sync-Eintrag." };
  }
  const e = entry as Record<string, unknown>;

  if (!isSyncTable(e.table)) {
    return { ok: false, error: "Unbekannte Tabelle." };
  }
  const table = e.table;
  if (typeof e.id !== "string" || !e.id.trim()) {
    return { ok: false, error: "Ungültige id." };
  }
  const clientUpdatedAt = parseClientUpdatedAt(e.client_updated_at);
  if (!clientUpdatedAt) {
    return {
      ok: false,
      error: "Ungültiger client_updated_at (ISO 8601 erwartet).",
    };
  }
  if (!e.data || typeof e.data !== "object" || Array.isArray(e.data)) {
    return { ok: false, error: "Ungültige Daten." };
  }

  // Rollen-Checks (identisch zu den bestehenden API-Routen)
  const admin = isAdmin(user);
  const planner = isPlanner(user);
  switch (table) {
    case "objects":
    case "object_items":
    case "inventory_items":
      if (!admin) {
        return {
          ok: false,
          error: "Nur Admins dürfen diese Daten synchronisieren.",
        };
      }
      break;
    case "weekly_default_routes":
    case "active_tours":
    case "tour_stops":
      if (!planner) {
        return {
          ok: false,
          error: "Nur Fahrer und Admins dürfen Touren synchronisieren.",
        };
      }
      break;
    case "profiles":
      // Fahrer/Facility-Manager dürfen nur ihr eigenes Profil syncen.
      if (e.id !== user.id && !admin) {
        return {
          ok: false,
          error: "Fremde Profile können nicht synchronisiert werden.",
        };
      }
      break;
  }

  // Whitelist anwenden + Daten validieren/bereinigen
  const whitelist = FIELD_WHITELISTS[table];
  const raw = e.data as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const key of whitelist) {
    if (key in raw) filtered[key] = raw[key];
  }
  const data = sanitizeSyncData(table, filtered);

  // Serverseitig erzwungene Felder
  if (table === "weekly_default_routes") {
    data.user_id = user.id; // Vorauswahl ist immer an den Nutzer gebunden
  }
  if (table === "active_tours" && !admin) {
    data.driver_id = user.id; // Fahrer syncen nur ihre eigenen Touren
  }
  if (table === "profiles" && !admin) {
    delete data.role; // Rolle nur durch Admins änderbar
  }

  return {
    ok: true,
    prepared: {
      table,
      id: e.id,
      client_updated_at: clientUpdatedAt,
      data,
    },
  };
}


/* ------------------------------------------------------------------ */
/* LWW-Schutz für die bestehenden API-Routen                          */
/* ------------------------------------------------------------------ */

/**
 * Ergebnis einer LWW-Vorabprüfung für reguläre Mutations-Routen:
 * - `ok`       → kein `client_updated_at` übermittelt (Legacy-Verhalten)
 * - `apply`    → eingehendes `client_updated_at` ist neuer → anwenden
 * - `conflict` → Server-Zustand ist neuer/gleich → 409 + serverRecord
 */
export type LwwCheck =
  | { status: "ok" }
  | { status: "apply"; clientUpdatedAt: string }
  | { status: "conflict"; serverRecord: SyncRow };

/**
 * Prüft vor einem Update, ob der eingehende `client_updated_at` neuer ist
 * als der in der DB gespeicherte. `extraEq` erlaubt zusätzliche Bedingungen
 * (z. B. `[["object_id", id]]` bei Items/Stopps).
 */
export async function checkLww(
  supabase: SupabaseClient<Database>,
  table: SyncTable,
  id: string,
  clientUpdatedAt: unknown,
  extraEq?: ReadonlyArray<readonly [string, unknown]>,
): Promise<LwwCheck> {
  const parsed = parseClientUpdatedAt(clientUpdatedAt);
  // Ohne client_updated_at: Legacy-Verhalten (kein LWW-Schutz nötig)
  if (!parsed) return { status: "ok" };

  const db = supabase as unknown as {
    from(name: string): SyncQuery;
  };

  let select: SyncFiltered = db
    .from(table)
    .select("id, client_updated_at")
    .eq("id", id);
  for (const [column, value] of extraEq ?? []) {
    select = select.eq(column, value);
  }
  const existing = await select.maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const existingMs =
      typeof existing.data.client_updated_at === "string"
        ? Date.parse(existing.data.client_updated_at)
        : 0;
    const incomingMs = Date.parse(parsed);
    if (incomingMs <= existingMs) {
      let serverQuery = db
        .from(table)
        .select("*")
        .eq("id", existing.data.id as string);
      for (const [column, value] of extraEq ?? []) {
        serverQuery = serverQuery.eq(column, value);
      }
      const server = await serverQuery.single();
      if (server.error) throw server.error;
      return { status: "conflict", serverRecord: server.data ?? {} };
    }
  }
  return { status: "apply", clientUpdatedAt: parsed };
}

/** Ergebnis eines LWW-Aufrufs. */
export type LwwOutcome =
  | { applied: true; record: SyncRow }
  | { applied: false; serverRecord: SyncRow };

/**
 * Wendet Last-Write-Wins auf einen Datensatz an:
 * - Zeile existiert & eingehendes client_updated_at ist NEUER → Update
 *   (+ synced_at = Serverzeit)
 * - Zeile existiert & eingehendes client_updated_at ist ÄLTER/gleich → Konflikt,
 *   Update wird verworfen, Server-Zustand zurückgegeben
 * - Zeile existiert nicht → Insert (mit client_updated_at + synced_at)
 */
export async function applyLww(
  supabase: SupabaseClient<Database>,
  table: SyncTable,
  id: string,
  clientUpdatedAt: string,
  data: Record<string, unknown>,
): Promise<LwwOutcome> {
  const now = new Date().toISOString();
  const db = supabase as unknown as {
    from(name: string): SyncQuery;
  };

  // Zuerst per id suchen, sonst ggf. über den natürlichen Schlüssel
  // (z. B. weekly_default_routes: user_id + day_of_week + object_id).
  let existingId: string | null = null;
  let existingClientUpdatedAt: string | null = null;

  const byId = await db
    .from(table)
    .select("id, client_updated_at")
    .eq("id", id)
    .maybeSingle();
  if (byId.error) throw byId.error;
  if (byId.data) {
    existingId = typeof byId.data.id === "string" ? byId.data.id : null;
    existingClientUpdatedAt =
      typeof byId.data.client_updated_at === "string"
        ? byId.data.client_updated_at
        : null;
  }

  if (!existingId && table === "weekly_default_routes") {
    const byNatural = await db
      .from("weekly_default_routes")
      .select("id, client_updated_at")
      .eq("user_id", data.user_id)
      .eq("day_of_week", data.day_of_week)
      .eq("object_id", data.object_id)
      .maybeSingle();
    if (byNatural.error) throw byNatural.error;
    if (byNatural.data) {
      existingId =
        typeof byNatural.data.id === "string" ? byNatural.data.id : null;
      existingClientUpdatedAt =
        typeof byNatural.data.client_updated_at === "string"
          ? byNatural.data.client_updated_at
          : null;
    }
  }

  if (existingId) {
    const existingMs = existingClientUpdatedAt
      ? Date.parse(existingClientUpdatedAt)
      : 0;
    const incomingMs = Date.parse(clientUpdatedAt);

    if (incomingMs <= existingMs) {
      // Conflict ignored → aktuellen Server-Zustand zurückmelden
      const server = await db
        .from(table)
        .select("*")
        .eq("id", existingId)
        .single();
      if (server.error) throw server.error;
      return { applied: false, serverRecord: server.data ?? {} };
    }

    const updated = await db
      .from(table)
      .update({ ...data, client_updated_at: clientUpdatedAt, synced_at: now })
      .eq("id", existingId)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return { applied: true, record: updated.data ?? {} };
  }

  // Neu anlegen. updated_at/created_at werden auf den Client-Zeitstempel
  // gesetzt (der set_updated_at-Trigger greift nur bei UPDATE).
  const created = await db
    .from(table)
    .insert({
      ...data,
      id,
      created_at: clientUpdatedAt,
      updated_at: clientUpdatedAt,
      client_updated_at: clientUpdatedAt,
      synced_at: now,
    })
    .select("*")
    .single();
  if (created.error) throw created.error;
  return { applied: true, record: created.data ?? {} };
}

/** Prüft, ob eine tour_stops-Zeile zu einer Tour des Nutzers gehört (oder er Admin ist). */
export async function ownsTourStop(
  supabase: SupabaseClient<Database>,
  user: CurrentUser,
  data: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isAdmin(user)) return { ok: true };
  const tourId = data.tour_id;
  if (typeof tourId !== "string") {
    return { ok: false, error: "tour_id fehlt." };
  }
  const db = supabase as unknown as {
    from(name: string): SyncQuery;
  };
  const tour = await db
    .from("active_tours")
    .select("driver_id")
    .eq("id", tourId)
    .maybeSingle();
  if (tour.error) throw tour.error;
  if (!tour.data || tour.data.driver_id !== user.id) {
    return { ok: false, error: "Stopp gehört nicht zu einer eigenen Tour." };
  }
  return { ok: true };
}
