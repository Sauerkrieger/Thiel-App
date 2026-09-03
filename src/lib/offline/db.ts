/**
 * IndexedDB-Wrapper für den Offline-First-Sync (siehe SPEC.md, Abschnitt 6).
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
// Version erhöhen, damit bestehende Installationen neue Stores und
// Indizes beim nächsten Öffnen anlegen (v6: sync_status-Index für
// schnelles Auslesen der Offline-Queue).
const DB_VERSION = 6;

export type OfflineTable = SyncTable | "chat_messages";
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
        const transaction = request.transaction;
        for (const table of [...SYNC_TABLES, "chat_messages" as const]) {
          const storeNameValue = storeName(table);
          const store = db.objectStoreNames.contains(storeNameValue)
            ? transaction?.objectStore(storeNameValue)
            : db.createObjectStore(storeNameValue, { keyPath: "id" });
          // sync_status-Index: getPendingRecords muss nicht mehr die ganze
          // Tabelle scannen, bevor gefiltert wird (Offline-Queue-Status wird
          // nach jeder Mutation aktualisiert).
          if (
            table !== "chat_messages" &&
            store &&
            !store.indexNames.contains("sync_status")
          ) {
            store.createIndex("sync_status", "sync_status", { unique: false });
          }
          if (table === "chat_messages" && store && !store.indexNames.contains("thread_id")) {
            store.createIndex("thread_id", "data.thread_id", { unique: false });
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

function storeName(table: OfflineTable): string {
  return `sync_${table}`;
}

/** Schreib-Transaktion: wartet auf den Abschluss der Transaktion. */
async function writeTx(
  table: OfflineTable,
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
  table: OfflineTable,
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

/** Legt einen oder mehrere Datensätze in einer Transaktion ab. */
export async function putRecords(
  table: OfflineTable,
  records: StoredRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await writeTx(table, (store) => {
    for (const record of records) store.put(record);
  });
}

/** Legt einen Datensatz ab (überschreibt vorhandenen mit gleicher id). */
export async function putRecord(
  table: OfflineTable,
  record: StoredRecord,
): Promise<void> {
  await putRecords(table, [record]);
}

/** Holt einen einzelnen Datensatz (oder null). */
export async function getRecord(
  table: OfflineTable,
  id: string,
): Promise<StoredRecord | null> {
  const result = await readTx(table, (store) => store.get(id));
  return result ?? null;
}

/** Alle Datensätze einer Tabelle. */
export async function getAllRecords(table: OfflineTable): Promise<StoredRecord[]> {
  const result = await readTx(table, (store) => store.getAll());
  return result ?? [];
}

/** Datensätze über einen vorhandenen IndexedDB-Index. */
export async function getRecordsByIndex(
  table: OfflineTable,
  indexName: string,
  key: IDBValidKey,
): Promise<StoredRecord[]> {
  const result = await readTx(table, (store) => store.index(indexName).getAll(key));
  return result ?? [];
}

/** Alle noch nicht hochgeladenen Datensätze einer Tabelle (über den Index). */
export async function getPendingRecords(
  table: OfflineTable,
): Promise<StoredRecord[]> {
  const result = await readTx(table, (store) =>
    store.index("sync_status").getAll("pending_upload"),
  );
  return result ?? [];
}

/** Löscht einen Datensatz. */
export async function deleteRecord(table: OfflineTable, id: string): Promise<void> {
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
