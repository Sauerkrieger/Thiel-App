/**
 * Gemeinsame, CLIENT-SICHERE Definition der synchronisierbaren Tabellen.
 *
 * Wird sowohl serverseitig (LWW-Registry in `@/lib/lww`) als auch clientseitig
 * (Offline-Lib in `src/lib/offline/`) verwendet – deshalb KEINE server-only-
 * Imports in dieser Datei.
 */

/** Alle über den Sync synchronisierbaren Tabellen. */
export type SyncTable =
  | "profiles"
  | "objects"
  | "object_items"
  | "inventory_items"
  | "weekly_default_routes"
  | "active_tours"
  | "tour_stops";

export const SYNC_TABLES: readonly SyncTable[] = [
  "profiles",
  "objects",
  "object_items",
  "inventory_items",
  "weekly_default_routes",
  "active_tours",
  "tour_stops",
];

export function isSyncTable(value: unknown): value is SyncTable {
  return (
    typeof value === "string" &&
    (SYNC_TABLES as readonly string[]).includes(value)
  );
}
