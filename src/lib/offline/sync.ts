/**
 * Sync-Engine für den Offline-First-Sync (siehe OFFLINE_SYNC_PLAN.md).
 *
 * - `queueMutation()`   legt einen lokal bearbeiteten Datensatz in die
 *                       IndexedDB-Queue (pending_upload) und stößt bei
 *                       Online-Verbindung sofort einen Sync an.
 * - `syncNow()`         sendet alle pending_upload-Einträge an POST /api/sync
 *                       (Last-Write-Wins im Backend) und übernimmt die
 *                       Server-Ergebnisse.
 * - Konflikte (Server neuer) → Server-Zustand wird lokal übernommen.
 * - Lokale Neu-Bearbeitungen nach dem Sync → lokaler Stand bleibt erhalten.
 * - `initSync()`        Online/Offline-Erkennung + automatischer Sync bei
 *                       Reconnect (wird in der App-Shell aufgerufen).
 * - `useSyncState()`    React-Hook für den Sync-/Offline-Indikator.
 */

"use client";

import { useSyncExternalStore } from "react";
import { SYNC_TABLES, type SyncTable } from "@/lib/sync-tables";
import {
  deleteRecord,
  getPendingRecords,
  getRecord,
  newUuid,
  putRecord,
  type StoredRecord,
} from "./db";
import { ensureTimeOffset, nowServerAligned } from "./clock";

export type SyncState = {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

/** Sync-Reihenfolge: referenzierende Zeilen erst nach ihren Eltern
 *  (objects vor object_items/weekly_default_routes; active_tours vor tour_stops). */
const SYNC_ORDER: readonly SyncTable[] = [
  "objects",
  "active_tours",
  "inventory_items",
  "profiles",
  "time_entries",
  "time_off_requests",
  "weekly_default_routes",
  "object_items",
  "tour_stops",
];

const MAX_ENTRIES_PER_REQUEST = 100;

let initialized = false;
let listeners = new Set<() => void>();
// Online-Status: Node ≥ 21 hat ein globales navigator-Objekt OHNE onLine-
// Property (undefined) – das würde serverseitig fälschlich als „Offline“
// gerendert und einen Hydration-Mismatch auslösen. Deshalb nur Browser-
// navigator mit echtem onLine (boolean) werten, sonst true.
function isBrowserOnline(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true
  );
}

let state: SyncState = {
  online: isBrowserOnline(),
  syncing: false,
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
};

/** Aktuelle Nutzer-Id (vom Layout gesetzt, für nutzerbezogene Daten). */
let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

/** Aktuelle Rolle (vom Layout gesetzt, für rollenabhängige Offline-Filter). */
let currentUserRole: string | null = null;

export function setCurrentUserRole(role: string | null): void {
  currentUserRole = role;
}

export function getCurrentUserRole(): string | null {
  return currentUserRole;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Aktueller Sync-Status (für useSyncState / Indikator). */
export function getSyncState(): SyncState {
  return state;
}

/** Abonniert Status-Änderungen; gibt eine Abmelde-Funktion zurück. */
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React-Hook für den Sync-/Offline-Indikator. */
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

/** Neue Client-UUID für offline angelegte Datensätze. */
export function newRecordId(): string {
  return newUuid();
}

async function refreshPendingCount(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  let count = 0;
  for (const table of SYNC_TABLES) {
    count += (await getPendingRecords(table)).length;
  }
  setState({ pendingCount: count });
}

/**
 * Legt einen lokal bearbeiteten Datensatz in die Offline-Queue.
 * `client_updated_at` wird server-ausgerichtet erzeugt (Clock-Skew-Mitigation).
 */
export async function queueMutation(
  table: SyncTable,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await ensureTimeOffset();
  const record: StoredRecord = {
    id,
    client_updated_at: nowServerAligned(),
    sync_status: "pending_upload",
    data,
  };
  await putRecord(table, record);
  await refreshPendingCount();
  if (getSyncState().online) {
    void syncNow();
  }
}

type SyncResultItem = {
  id: string;
  applied?: boolean;
  serverRecord?: Record<string, unknown>;
  error?: string;
};

/** Übernimmt ein Sync-Ergebnis. Server-Zustand gewinnt bei Konflikt. */
async function handleResult(table: SyncTable, result: SyncResultItem): Promise<void> {
  if (result.error) return; // bleibt pending → nächster Sync-Versuch
  if (!result.serverRecord) {
    // Kein serverRecord (sollte nicht vorkommen) → aufräumen
    if (result.applied) await deleteRecord(table, result.id);
    return;
  }
  await storeServerRecord(table, result.id, result.serverRecord);
}

async function storeServerRecord(
  table: SyncTable,
  clientId: string,
  serverRecord: Record<string, unknown>,
): Promise<void> {
  const serverId =
    typeof serverRecord.id === "string" ? serverRecord.id : clientId;
  const serverTs =
    typeof serverRecord.client_updated_at === "string"
      ? Date.parse(serverRecord.client_updated_at)
      : 0;

  // Falls der Nutzer lokal NACH dem Sync weiterbearbeitet hat, hat der
  // lokale Stand Vorrang (er wird beim nächsten Sync erneut gesendet).
  const local = await getRecord(table, clientId);
  const localTs = local ? Date.parse(local.client_updated_at) : 0;
  if (local && local.sync_status === "pending_upload" && localTs > serverTs) {
    if (serverId !== clientId) {
      await deleteRecord(table, clientId);
      await putRecord(table, { ...local, id: serverId });
    }
    return;
  }

  await deleteRecord(table, clientId);
  if (serverId !== clientId) await deleteRecord(table, serverId);
  await putRecord(table, {
    id: serverId,
    client_updated_at:
      typeof serverRecord.client_updated_at === "string"
        ? serverRecord.client_updated_at
        : new Date().toISOString(),
    sync_status: "synced",
    data: serverRecord,
  });
}

/**
 * Übernimmt einen Server-Datensatz in den lokalen Cache (Quelle der
 * Wahrheit). Wird genutzt für: Online-Mutationsantworten, 409-Konflikte,
 * Sync-Ergebnisse und GET-Caching. Ein neuerer lokaler pending-Eintrag
 * behält dabei Vorrang.
 */
export async function ingestServerRecord(
  table: SyncTable,
  serverRecord: Record<string, unknown>,
): Promise<void> {
  const id = typeof serverRecord.id === "string" ? serverRecord.id : newUuid();
  await storeServerRecord(table, id, serverRecord);
}

/** Sendet alle pending_upload-Datensätze an den Server (LWW). */
export async function syncNow(): Promise<void> {
  if (state.syncing) return;
  if (typeof indexedDB === "undefined") return;

  await ensureTimeOffset();
  setState({ syncing: true, lastError: null });

  try {
    for (const table of SYNC_ORDER) {
      const pending = await getPendingRecords(table);
      if (pending.length === 0) continue;

      // In Häppchen senden (Server-Limit: 200 Einträge pro Request)
      for (let i = 0; i < pending.length; i += MAX_ENTRIES_PER_REQUEST) {
        const chunk = pending.slice(i, i + MAX_ENTRIES_PER_REQUEST);
        const entries = chunk.map((record) => ({
          table,
          id: record.id,
          client_updated_at: record.client_updated_at,
          data: record.data,
        }));

        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        });
        if (!res.ok) {
          if (res.status === 401) {
            setState({ lastError: "Sitzung abgelaufen – bitte neu anmelden." });
            return;
          }
          throw new Error(`Sync fehlgeschlagen (HTTP ${res.status}).`);
        }

        const body = (await res.json()) as {
          results: SyncResultItem[];
        };
        for (const result of body.results ?? []) {
          await handleResult(table, result);
        }
      }
    }
    setState({ lastSyncAt: new Date().toISOString() });
  } catch (e) {
    setState({
      lastError: e instanceof Error ? e.message : "Sync fehlgeschlagen.",
    });
  } finally {
    await refreshPendingCount();
    setState({ syncing: false });
  }
}

/**
 * Initialisiert die Sync-Engine: Online/Offline-Erkennung, automatischer
 * Sync bei Reconnect, Zeit-Offset + Pending-Zähler beim Start.
 * `userId` ist die aktuelle Nutzer-Id (für nutzerbezogene Cache-Daten).
 */
export function initSync(userId: string | null = null): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;

  setCurrentUserId(userId);
  if (initialized) return; // Listener nur einmal registrieren
  initialized = true;

  const applyOnline = () => {
    setState({ online: navigator.onLine });
    if (navigator.onLine) void syncNow();
  };
  const applyOffline = () => {
    setState({ online: false });
  };

  window.addEventListener("online", applyOnline);
  window.addEventListener("offline", applyOffline);

  setState({ online: navigator.onLine });
  void refreshPendingCount();
  if (navigator.onLine) {
    void ensureTimeOffset();
    void syncNow();
  }
}
