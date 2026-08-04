# Offline-First-Sync (LWW) – Bauplan

**Datum:** 2026-08-04
**Status:** Schritt 1 abgeschlossen, Rest offen (siehe TODO-Liste unten).

---

## 1. Architektur-Überblick

Die App (Next.js App Router + Supabase/Postgres) wird offline-fähig: Schreibzugriffe
gehen offline in eine **IndexedDB-Queue**, online werden sie per **Last-Write-Wins (LWW)**
mit dem Server synchronisiert.

**Scope-Entscheidungen (vom Nutzer bestätigt):**

| Entscheidung | Wert |
|---|---|
| Offline-fähige Daten | **Alles inkl. Profile** (objects, object_items, inventory_items, weekly_default_routes, active_tours, tour_stops, profiles) |
| Offline-Löschungen | **Keine** – Löschen passiert nur online (keine Tombstones) |
| Fotos | **Nur online** (Item-Fotos, Foto-Import) |
| Umsetzung | Alles in einem Zug |

**Kernprinzipien:**

1. **Clientseitige Speicherung (IndexedDB):** Offline erstellte/bearbeitete Datensätze
   liegen lokal. Jeder Datensatz trägt:
   - `id` – eindeutige UUID (vom Client generiert, falls neu)
   - `client_updated_at` – ISO 8601 UTC-Zeitstempel der tatsächlichen Bearbeitung auf dem Gerät
   - `sync_status` – Enum `('synced' | 'pending_upload')`
2. **Clock-Skew-Mitigation:** Beim ersten Server-Kontakt wird
   `timeOffset = serverTime - localClientTime` berechnet und gecacht.
   `client_updated_at` wird als `Date.now() + timeOffset` erzeugt, damit der
   Zeitstempel serverseitig vergleichbar bleibt.
3. **Sync:** Bei Reconnect werden alle Datensätze mit `sync_status = 'pending_upload'`
   an den Server gesendet.
4. **LWW im Backend:** Bei einem UPDATE wird der eingehende `client_updated_at` mit dem
   in der DB gespeicherten verglichen:
   - eingehend **neuer** → Update durchführen, `synced_at = now()` setzen
   - eingehend **älter** → Update verwerfen (Conflict ignored), aktuellen Server-Zustand
     an den Client zurückmelden, damit dieser lokal aktualisiert wird.
5. **Zeitstempel-Transparenz:** Jede Tabelle hält `created_at`/`updated_at`
   (`updated_at` basiert auf `client_updated_at`, zeigt die tatsächliche
   Bearbeitungszeit) und `synced_at` (wann die Daten auf den Server gelangten).

---

## 2. Datenbankschema

### 2.1 Neue Spalten (Migration `20260804000002_offline_sync_columns.sql`)

> **Hinweis:** Die Migrationsnummer war ursprünglich `20260804000001` – sie
> kollidierte mit der bereits angewendeten `20260804000001_object_remarks.sql`
> und wurde auf `20260804000002` umbenannt.

Alle synchronisierbaren Tabellen erhalten:

| Spalte | Typ | Bedeutung |
|---|---|---|
| `client_updated_at` | `timestamptz` (nullable) | Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis) |
| `synced_at` | `timestamptz` (nullable) | Serverzeit, wann der Datensatz zuletzt synchronisiert wurde |

Zusätzlich erhalten **`object_items`** und **`tour_stops`** ein bislang fehlendes
`updated_at timestamptz not null default now()` (inkl. `set_updated_at`-Trigger).

### 2.2 Trigger-Anpassung

Der generische Trigger `public.set_updated_at()` wird so erweitert, dass er
`client_updated_at` bevorzugt:

```sql
if new.client_updated_at is not null then
  new.updated_at = new.client_updated_at;
else
  new.updated_at = now();
end if;
```

→ `updated_at` zeigt damit immer den echten Bearbeitungszeitpunkt (auch bei
offline erstellten Datensätzen), `synced_at` bleibt davon getrennt.

### 2.3 Betroffene Tabellen (Ist-Stand → Soll-Stand)

| Tabelle | hat `updated_at`? | erhält |
|---|---|---|
| `objects` | ja | `client_updated_at`, `synced_at` |
| `object_items` | **nein** | `updated_at`, `client_updated_at`, `synced_at` |
| `inventory_items` | ja | `client_updated_at`, `synced_at` |
| `weekly_default_routes` | ja | `client_updated_at`, `synced_at` |
| `active_tours` | ja | `client_updated_at`, `synced_at` |
| `tour_stops` | **nein** | `updated_at`, `client_updated_at`, `synced_at` |
| `profiles` | ja | `client_updated_at`, `synced_at` |

**Keine `sync_tombstones`-Tabelle** – Löschen ist bewusst online-only.

### 2.4 Bewusste Sync-Entscheidungen (dokumentiert)

| Entscheidung | Grund |
|---|---|
| `profiles.email` ist **nicht** über den Sync änderbar | Die E-Mail ist die Login-Kennung und hängt an `auth.users` (Doppel-Update nötig). Username/Email-Änderungen laufen weiterhin online über `PATCH /api/auth/me-profile`. Offline syncbar: `name` (alle) und `role` (nur Admin) |
| `weekly_default_routes`: natürlicher Schlüssel `(user_id, day_of_week, object_id)` | Liefert der Client eine neue UUID für eine bereits existierende Kombination, wird die Server-Zeile unter ihrer ID aktualisiert → **Client muss die zurückgegebene `record.id` übernehmen** |
| Sync-Reihenfolge: Tour **vor** ihren Stopps | `ownsTourStop` validiert Stopps von Nicht-Admins gegen die Serverseite-Tour; im Batch muss die Tour also vor ihren Stopps gesendet werden |
| `updated_at`/`created_at` bei neuen Datensätzen = `client_updated_at` | Der `set_updated_at`-Trigger greift nur bei UPDATE; beim Insert werden die Zeitstempel daher explizit auf den Client-Zeitstempel gesetzt (echter Bearbeitungszeitpunkt) |

---

## 3. Endpunkte

### 3.1 Neu

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/time` | Serverzeit (ISO 8601) für die Clock-Skew-Berechnung |
| `POST` | `/api/sync` | Batch-Sync: nimmt eine Liste `{ table, id, client_updated_at, data }` entgegen, wendet LWW pro Datensatz an und liefert pro Datensatz `{ id, applied, serverRecord? }` zurück |

`/api/sync` deckt die LWW-Registry ab für: `objects`, `object_items`,
`inventory_items`, `weekly_default_routes`, `active_tours`, `tour_stops`, `profiles`.

### 3.2 Bestehende Routen (LWW-Ergänzung)

Die normalen Mutations-Routen bekommen denselben LWW-Schutz (eingehendes
`client_updated_at` vs. DB-Wert; bei Konflikt `409` mit aktuellem Server-Zustand):

| Route | Entity |
|---|---|
| `POST/PATCH /api/objects`, `/api/objects/[id]` | objects |
| `/api/objects/[id]/items`, `[itemId]` | object_items |
| `POST/PATCH/DELETE /api/inventory`, `/api/inventory/[id]` | inventory_items |
| `POST /api/planning` (Default-Routen) | weekly_default_routes |
| `POST/PATCH /api/tours`, `/api/tours/[id]`, `stops/[stopId]` | active_tours, tour_stops |
| `PATCH /api/auth/me-profile` | profiles |
| `POST/PATCH /api/auth/users`, `[id]` (Admin) | profiles |

**Löschungen** (`DELETE`) bleiben unverändert online-only (kein Offline-Queue).

---

## 4. Frontend-Architektur (neu: `src/lib/offline/`)

| Datei | Inhalt |
|---|---|
| `src/lib/offline/db.ts` | IndexedDB-Wrapper: Stores pro Entität, `put`/`get`/`getAll`, UUID-Erzeugung, setzt `client_updated_at` + `sync_status` |
| `src/lib/offline/clock.ts` | Time-Offset (`serverTime - Date.now()`, via `GET /api/time`, in `localStorage` gecacht); `nowServerAligned()` |
| `src/lib/offline/sync.ts` | Sync-Engine: sammelt `pending_upload`, sendet an `POST /api/sync`, verarbeitet Konflikte (Server-Zustand übernehmen), Online/Offline-Erkennung (`navigator.onLine` + Events), automatischer Sync bei Reconnect |
| `src/lib/offline/fetch.ts` | `offlineFetch()`-Wrapper mit Endpoint-Mapping (welche Routen offline gequeued werden, welche online bleiben), Offline-Read-Assembler (GET liefert aus IndexedDB, wenn offline) |

**Umzustellende Komponenten:** `objects-page.tsx`, `object-form-dialog.tsx`,
`items-dialog.tsx`, `inventory-page.tsx`, `planning-page.tsx`, `tour-page.tsx`,
`delivery-dialog.tsx`, `history-page.tsx`, `settings-page.tsx`.

**UI:** Sync-/Offline-Indikator in `app-shell.tsx` (Status: online/offline,
offene Syncs, letzter Sync).

---

## 5. TODO-Liste

- [x] **1. DB-Migrationen & Types** ✅ – Migration `20260804000002_offline_sync_columns.sql`
      erstellt (Spalten + Trigger-Anpassung; umbenannt wegen Versions-Kollision mit
      `20260804000001_object_remarks.sql`), `src/types/database.ts` um neue Felder
      erweitert (alle 7 Sync-Tabellen, inkl. `updated_at` für `object_items`/`tour_stops`)
- [x] **2. Backend: `GET /api/time` + `POST /api/sync`** ✅ – Clock-Skew-Endpoint +
      Batch-Sync mit LWW-Registry (`src/lib/lww.ts`: Feld-Whitelists, Rollen-Checks,
      Daten-Validierung, `applyLww`) über alle Sync-Tabellen
- [x] **3. Backend: LWW in bestehenden API-Routen** ✅ – `checkLww()` in `src/lib/lww.ts`
      (Vergleich client_updated_at vs. DB, Konflikt → 409 + `serverRecord` via
      `lwwConflictResponse()` in `src/lib/http.ts`); umgestellt: objects (POST/PUT +
      items), inventory (POST/PUT), planning (LWW pro Wochentag inkl. Zeitstempel-
      Stamping nach dem RPC), tours/stops (POST/PATCH), me-profile, users (POST/PATCH)
- [x] **4. Frontend: Offline-Lib** ✅ – `src/lib/offline/db.ts` (IndexedDB-Wrapper,
      UUID), `clock.ts` (Clock-Skew via `GET /api/time`, localStorage-Cache),
      `sync.ts` (Sync-Engine: `queueMutation`, `syncNow` in Abhängigkeits-Reihenfolge
      mit Chunking, Konflikt-Handling mit ID-Remap + Schutz lokaler Neu-Editierungen,
      Online/Offline-Erkennung, `initSync`, Observable-Store + `useSyncState`-Hook);
      `src/lib/sync-tables.ts` als client-sichere gemeinsame Tabellen-Definition;
      `POST /api/sync` liefert jetzt auch bei `applied: true` den `serverRecord`
      (Quelle der Wahrheit inkl. ID-Remap)
- [x] **5. Frontend: `offlineFetch`-Wrapper** ✅ – `src/lib/offline/fetch.ts`:
      Endpoint-Mapping (welche Mutationen offline gequeued werden, welche GETs
      offline lesbar sind), Cache-Logik (partielle Antworten werden gemergt,
      pending gewinnt), Offline-Read-Assembler für objects/items/inventory/
      planning/tours/pack-info/users, 409-Konflikt-Ingest, 503 für Online-only
- [x] **6. Frontend: Komponenten umstellen** ✅ – fetch → `offlineFetch` in:
      objects-page, object-form-dialog (nur Speichern), items-dialog,
      inventory-page, planning-page, tour-page, delivery-dialog, pack-dialog,
      history-page, settings-page (me-profile/users). Foto-/OCR-/Auth-
      Endpunkte bleiben online
- [x] **7. UI: Sync-/Offline-Indikator** ✅ – SyncBadge in `app-shell.tsx`
      (Offline / Synchronisiert / „n offline“ mit Klick-Sync / Fehler),
      `initSync(userId)` beim Mount, `layout.tsx` reicht `userId` durch
- [x] **8. Validierung & Deploy** ✅ – `npx tsc --noEmit` fehlerfrei, `next build`
      erfolgreich, Code-Review ohne kritische Befunde; `db push` (Migration
      `20260804000002` auf der Remote-DB angewendet, Spalten verifiziert),
      Commit `e0a836b` & Push auf `main`

### 5.1 Bekannte Einschränkungen (dokumentiert)

| Einschränkung | Grund / Verhalten |
|---|---|
| `PUT /api/planning` (Auswahl speichern) ist **online-only** | Die Server-RPC ersetzt den gesamten Wochentag (inkl. Entfernen) – Entfernen ist offline nicht möglich („Löschen nur online“). Offline → saubere 503-Meldung; das Anzeigen der Auswahl funktioniert offline aus dem Cache |
| Benutzer anlegen (`POST /api/auth/users`) & Passwort/Passkeys/Logout sind online-only | Erfordern Server-Auth (Passwort-Hash, WebAuthn) |
| Offline-Objektedit ersetzt Items per Name (Union, kein Entfernen) | Entfernen nur online; umbenannte Items können nach dem Sync doppelt angelegt werden |
| Offline-Historie: Lieferstatus (`0/x`) nur vollständig, wenn Touren-Detailseiten zuvor geladen wurden | `GET /api/tours` liefert keine Stopps; `tour_stops` werden erst beim Detail-GET gecacht |
| Planungs-GET cached partielle Objekte (ohne Koordinaten) | Falls nie `GET /api/objects` geladen wurde, fehlen offline Koordinaten (Navigation/Karte degradiert) – Merge schützt vorhandene volle Zeilen |
