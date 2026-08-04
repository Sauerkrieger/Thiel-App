/**
 * IndexedDB-Wrapper für den Offline-First-Sync (siehe OFFLINE_SYNC_PLAN.md).
 *
 * Pro Sync-Tabelle ein Object-Store; Schlüssel ist die Datensatz-Id.
 * Jeder gespeicherte Datensatz trägt:
 *   - id                – Datensatz-Id (Client-UUID bei neuen Datensätzen)
 *   - client_updated_at – ISO-8601-Zeitstempel der letzten Bearbeitung (LWW-Basis)
 *   - sync_status       – 'synced' | 'pending_upload'
 *   - data              – der vollständige Datensatz (Server-Zeile bzw. lokaler Stand)
 */

import { SYNC_TABLES, type SyncTable } from "@/lib/sync-tables";

const DB_NAME = "thiel-offline";
const DB_VERSION = 1;

export type SyncStatus = "synced" | "pending_upload";

export type StoredRecord = {
  id: string;
  client_updated_at: string;
  sync_status: SyncStatus;
  data: Record<string, unknown>;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB ist in diesem Browser nicht verfügbar."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const table of SYNC_TABLES) {
          const store = storeName(table);
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: "id" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null; // Fehlversuch nicht dauerhaft cachen
        reject(
          request.error ?? new Error("IndexedDB konnte nicht geöffnet werden."),
        );
      };
    });
  }
  return dbPromise;
}

function storeName(table: SyncTable): string {
  return `sync_${table}`;
}

/** Schreib-Transaktion: wartet auf den Abschluss der Transaktion. */
async function writeTx(
  table: SyncTable,
  action: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName(table), "readwrite");
    action(tx.objectStore(storeName(table)));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Lese-Transaktion: löst mit dem Ergebnis des Requests auf. */
async function readTx<T>(
  table: SyncTable,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName(table), "readonly");
    const request = action(tx.objectStore(storeName(table)));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** Legt einen Datensatz ab (überschreibt vorhandenen mit gleicher id). */
export async function putRecord(
  table: SyncTable,
  record: StoredRecord,
): Promise<void> {
  await writeTx(table, (store) => {
    store.put(record);
  });
}

/** Holt einen einzelnen Datensatz (oder null). */
export async function getRecord(
  table: SyncTable,
  id: string,
): Promise<StoredRecord | null> {
  const result = await readTx(table, (store) => store.get(id));
  return result ?? null;
}

/** Alle Datensätze einer Tabelle. */
export async function getAllRecords(table: SyncTable): Promise<StoredRecord[]> {
  const result = await readTx(table, (store) => store.getAll());
  return result ?? [];
}

/** Alle noch nicht hochgeladenen Datensätze einer Tabelle. */
export async function getPendingRecords(
  table: SyncTable,
): Promise<StoredRecord[]> {
  const all = await getAllRecords(table);
  return all.filter((record) => record.sync_status === "pending_upload");
}

/** Löscht einen Datensatz. */
export async function deleteRecord(table: SyncTable, id: string): Promise<void> {
  await writeTx(table, (store) => {
    store.delete(id);
  });
}

/** Erzeugt eine eindeutige UUID (crypto.randomUUID mit Fallback). */
export function newUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
