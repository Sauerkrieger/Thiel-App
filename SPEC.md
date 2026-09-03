# Thiel Dienstleistungen – System-Spezifikation

Liefer- & Tourenplanungs-App für Thiel Dienstleistungen (mobile-optimierte Web-App).
Stand: August 2026 – beschreibt den **aktuellen Ist-Zustand** des Codes.

---

## 1. Überblick

Die App unterstützt den kompletten Arbeitsablauf einer Reinigungs-/Liefer-Rundtour:

1. **Objekte verwalten** (Ziele, Treppenhäuser) inkl. Items, Schlüsselnummern und Fotos
2. **Touren planen** – manuelle Auswahl, Foto-Auswahl und optimierte Rundtour vom/zum Lager
3. **Packen** – konsolidierte Packlisten je Objekt, Route auf der Karte
4. **Ausliefern** – Stopps in optimierter Reihenfolge, Items vorab gecheckt, Belieferung abhaken
5. **Historie & Einstellungen** – vergangene Touren, Profil, Passwort, Passkeys
6. **Zeiterfassung & Urlaubsverwaltung** – Stempeluhr, Arbeitszeit-Nachreichung, Abwesenheitsanträge, Zeitadmin mit Prüfbedarf (Auto-Timeout für vergessene Ausstempelungen)
7. **Chat** – Mitarbeiter-/Admin-Kommunikation mit Medien, Broadcasts, Übersetzung, Push und Offline-Unterstützung

Der Ablauf ist als **Rundtour** modelliert: Start und Ziel ist immer das Lager
**Thiel Dienstleistungen** (Standard: *Sartoriusstraße 14, 97072 Würzburg*, per Env
`WAREHOUSE_ADDRESS` änderbar).

## 2. Tech-Stack & Architektur

| Ebene | Technologie | Zweck |
| :--- | :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, shadcn/ui (Radix), lucide-react, sonner | Mobile-optimierte UI, Server Components + Client-Komponenten |
| **Backend / DB** | Supabase (PostgreSQL + Auth + Storage), `@supabase/ssr` | Datenmodell, Sessions, RLS, Storage-Bucket für Item-Fotos |
| **Auth** | Supabase Auth (Passwort) + WebAuthn-Passkeys (`@simplewebauthn`) | Login per Benutzername/Passwort **und** Fingerabdruck/Face ID |
| **Routen-Optimierung** | ORS Optimization API (VROOM) mit Custom-Matrix | Optimale Rundtour unter Zeitfenstern & Restriktionen |
| **Live-Verkehr** | TomTom Routing Matrix API | Aktuelle Fahrzeiten (inkl. Stau) als VROOM-Custom-Matrix |
| **Geocoding** | OpenRouteService Geocode Search | Adress-Autocomplete & Koordinaten-Verifizierung |
| **Fußgängerzonen** | Overpass API (OpenStreetMap) | Automatische Erkennung + nächster befahrbarer Haltepunkt |
| **Karten** | Leaflet (imperativ, ohne react-leaflet), OSM-Tiles, ORS-Directions | Routen-Geometrie in Pack- & Tour-Modus |
| **OCR / Vision** | Gemini Vision API | Erkennung von abfotografierten Listen (Objekte, Schlüssel, Items) |
| **Routen-Fallback** | ORS-Matrix → Google-Matrix → Haversine + eigener TSP-Solver | Optimierung läuft auch ohne Primär-API |

## 3. Datenmodell (Supabase/PostgreSQL)

**Enums:** `user_role` (`driver` | `admin` | `facility_manager` | `substitute`),
`contract_type` (`full_time` | `part_time` | `mini_job` | `custom`), `object_category` (`objekt` | `treppenhaus`), `tour_status` (`packing` | `in_transit` | `completed`),
`time_entry_source` (`clock` | `submitted`), `time_off_type` (`vacation` | `sick_leave` | `unpaid` | `compensatory`), `time_off_status` (`pending` | `approved` | `rejected`).

### `profiles` – Benutzerprofile (1:1 zu `auth.users`)
- `id` (PK → auth.users, cascade), `name`, `role` (user_role, default `driver`), `email`, `created_at`, `updated_at`
- `contract_type` (`full_time` | `part_time` | `mini_job` | `custom`, default `full_time`) – Vertragsart, steuert das Soll im Überstundenkonto
- `weekly_target_hours` (numeric, default 40) – **Wochen-Sollstunden** fürs Überstundenkonto (Auto-Fill: Vollzeit 40 / Teilzeit 20 / Minijob 10; bei `custom` frei)
- `working_days_per_week` (numeric, default 5) – geplante Arbeitstage pro Woche (Auto-Fill: 5/5/2; bei `custom` frei, Basis für den Urlaubsanspruch)
- `vacation_days_per_year` (integer, default 30) – **individuelle Jahresurlaubstage**; Resturlaub überall = `vacation_days_per_year − vacation_days_used` (Auto-Fill: 30/30/12, in allen Vertragsarten manuell überschreibbar)
- Auto-Fill beim Anlegen/Bearbeiten: Vollzeit → 40 h / 5 Tage / 30 Tage, Teilzeit → 20 h / 5 Tage / 30 Tage, Minijob → 10 h / 2 Tage / 12 Tage; `custom` zeigt Soll-Stunden & Arbeitstage als Eingabefelder, Urlaubsanspruch wird als `round(30 × Arbeitstage ÷ 5)` vorgeschlagen
- Trigger `on_auth_user_created` legt das Profil bei Auth-Registrierung automatisch an (inkl. Vertrags-Defaults)
- **Login-Kennung:** Benutzername wird auf `{name}@thiel.local` gemappt

### `time_entries` – Arbeitszeit-Stempelungen
- `id`, `user_id` (FK auth.users, cascade), `clock_in`, `clock_out` (nullable), `break_duration_minutes` (default 0), `note` (nullable)
- `is_approved` (bool, default true) – Freigabestatus; `requires_review` (bool, default false) – Prüfbedarf (vergessene Ausstempelung)
- `source` (`time_entry_source`): `clock` = Stempeluhr, `submitted` = nachgereichte Arbeitszeit
- **Maximal EIN offener Eintrag pro Nutzer** (partieller Unique-Index `WHERE clock_out IS NULL`)
- LWW-Offline-Felder (`client_updated_at`, `synced_at`) + `updated_at`-Trigger
- **Auto-Timeout-Trigger `set_time_entry_review_flag`:** Offene Stempelungen, die **12 h** überschreiten ODER **Mitternacht (00:00, Europa/Berlin)** erreichen, werden automatisch `requires_review = true` + `is_approved = false`; normales Ausstempeln bzw. Admin-Freigabe setzt `requires_review` zurück
- Housekeeping-Funktion `flag_overdue_time_entries()` markiert „im Stillen“ überfällige Einträge (läuft bei jedem Lese-/Schreibzugriff auf Zeitdaten)
- **Min-Pausen-Trigger `enforce_min_break` (§ 4 ArbZG):** Bei jedem Schreibvorgang mit `clock_out` wird die Anwesenheitszeit geprüft und die erfasste Pause per `greatest(erfasst, Mindestpause)` auf das gesetzliche Minimum ergänzt – **> 6 bis 9 Std. → 30 Min., > 9 Std. → 45 Min.** (nie reduziert). Backfill hebt Bestandsdaten an. Netto-Arbeitszeit = `(clock_out − clock_in) − break_duration_minutes` (`workedMinutesOf`)

### `time_entry_audit_logs` – Revisionssicheres Änderungsprotokoll
- `id`, `time_entry_id` (FK time_entries, **`on delete set null`** – Protokoll überlebt das Löschen des Eintrags), `changed_by_user_id` (FK auth.users, `on delete set null`)
- `changed_at` (timestamptz, default `now()`), `old_values` / `new_values` (jsonb – z. B. clock_in, clock_out, Pause, Freigabe-Status), `change_reason` (text – Notiz/Begründung)
- Wird **serverseitig** geschrieben, wenn ein Admin eine Stempelung im Zeitadmin anpasst, schließt, freigibt oder löscht (inkl. Offline-Änderungen via `/api/sync`) – **und** wenn ein Mitarbeiter eine vergessene Ausstempelung nachreicht (Zwangspopup) oder Arbeitszeit nachträglich einreicht (online wie offline); No-op-Updates werden übersprungen
- RLS: Lesen nur für Admins (`current_user_role() = 'admin'`), Schreiben nur über die Service-Rolle

### `time_off_requests` – Abwesenheitsanträge
- `id`, `user_id` (FK auth.users, cascade), `type` (`vacation` | `sick_leave` | `unpaid` | `compensatory`), `start_date`, `end_date`
- `status` (`pending` | `approved` | `rejected`), `reviewer_note`, `employee_note`
- `substitute_request` (boolean), `substitute_kind` (`driver` | `facility_manager`), `substitute_object_id` (optionales FK auf `objects`)
- Springer-Vorschläge werden mit `substitute_request = true` und `status = pending` gespeichert; Admin-Freigabe macht sie aktiv
- LWW-Offline-Felder; Trigger verbuchen genehmigte Urlaubstage auf das Konto (`vacation_days_used`): `calculate_time_off_workdays(uuid, date, date)` zählt Montag–Freitag im angegebenen Zeitraum und skaliert die Zahl proportional zu `working_days_per_week` (Default 5); `recalculate_vacation_days_used(uuid)` summiert nur **genehmigte** (`approved`) Urlaubsanträge (`type = 'vacation'`) des **aktuellen Kalenderjahres**, gekappt auf `[Jahresanfang, Jahresende]`. Trigger `sync_vacation_days_used` läuft bei Insert/Update/Delete auf `time_off_requests`, ein weiterer bei Änderung von `working_days_per_week` auf `profiles`. Die früheren Kalendertage-basierten Trigger wurden entfernt

### `objects` – Ziele/Treppenhäuser
- `id`, `name`, `address`, `category`
- `is_pedestrian_zone_until_11` – Fußgängerzone (wird per Overpass automatisch erkannt, keine manuelle Checkbox): direktes Anfahren nur bis 11:00 Uhr möglich, sonst über den nächsten befahrbaren Haltepunkt + Fußweg
- `opens_at` (time, nullable) – Öffnungszeit: **DARF erst ab dieser Uhrzeit angefahren werden**
- `latitude`, `longitude` (ORS-verifizierte Koordinaten, nullable)
- `key_number` (integer, nullable)

### `object_assignments` – Objektzuweisungen (m:n Benutzer ↔ Objekt)
- `user_id` (FK auth.users, cascade), `object_id` (FK objects, cascade), `created_at`
- Primary Key `(user_id, object_id)`
- Steuert die Sichtbarkeit für **Reinigungskräfte** (`facility_manager`): Sie sehen nur die
  hier zugewiesenen Objekte (und deren Items) – online wie offline. Beim Anlegen einer
  Reinigungskraft ist mindestens eine Zuweisung Pflicht.

### `object_items` – Items eines Objekts
- `id`, `object_id` (FK cascade), `item_name`
- `is_always_required` – fest ausgewählt & ausgegraut im Pack-/Tour-Modus (im Foto-Import je Item per Checkbox setzbar)
- `quantity` (default 1), `note` (nullable), `photo_path` (nullable, Storage)
- Kein Unique-Constraint auf `(object_id, item_name)` – gleiche Bezeichnung mit unterschiedlicher Menge/Bemerkung ist erlaubt

### `inventory_items` – Inventar (Item-Katalog, nur Admin)
- `id`, `name`, `note` (nullable, Anmerkung), `created_at`, `updated_at`
- RLS: Lesen für alle authentifizierten Nutzer, verwalten (anlegen/bearbeiten/löschen) nur für Admins
- Seed: initiale Item-Liste (Franzenmop, M-Power, Micromops-Varianten, Tana SR13, …)

### `chat_threads`, `chat_messages` & `chat_translations` – Kommunikation
- `chat_threads` verbindet jeweils einen Mitarbeiter mit einem Admin; pro Teilnehmerpaar genau ein Thread
- `chat_messages` unterstützt Text, Bild und Audio mit Status `sent`/`delivered`/`read`, Eilmeldungen, Transkript und Medienpfad
- `chat_translations` cached Übersetzungen je Nachricht und Zielsprache
- Storage-Bucket `chat-media` ist privat; Medien werden beim Lesen per kurzlebiger Signed URL ausgeliefert
- Realtime-Publication umfasst Threads, Nachrichten und Übersetzungen; die Summary-Abfrage liefert Kontakte, Threads und ungelesene Anzahl
- Performance: gezielte Spaltenauswahl, Indizes für Thread-/Zeit- und Unread-Abfragen sowie Debouncing der Realtime-Refreshes

### `push_subscriptions` & `company_settings` – Chat-Unterstützung
- `push_subscriptions` speichert Web-Push-Endpunkte je Benutzer; ungültige Endpunkte werden beim Versand entfernt
- `company_settings` enthält die optionale Support-Telefonnummer
- `profiles.chat_preferred_language` speichert die persönliche Übersetzungssprache; `profiles.phone` die Telefonnummer

### `active_tours` + `tour_stops` – Touren
- `active_tours`: `id`, `driver_id`, `date`, `status` (packing → in_transit → completed), `start_time`, `warehouse_arrival` (geplante Rückkehr ins Lager), `total_duration_minutes`
- `tour_stops`: `id`, `tour_id` (FK cascade), `object_id` (**nullable** – bei temporären Zielen), `stop_order` (unique je Tour), `arrival_time`, `is_delivered`, `key_number` (explizit im Pack-Modus ausgewählte Schlüssel), `next_delivery_items` (jsonb – vorgemerkte Extra-Items für die **nächste** Belieferung)
- **Temporäre/unbekannte Ziele** (Migration `20260903000000_unknown_tour_targets.sql`): `is_unknown` (bool), `unknown_target_id` (Client-Id), `unknown_name`, `unknown_address`, `unknown_latitude`, `unknown_longitude` – Snapshots nur des Tour-Stopp; kein Eintrag in `objects`, nur für diese Tour sichtbar (inkl. Historie), beim Löschen der Tour bzw. bei Neuberechnung ohne Auswahl entfernt

### Passkeys & Challenges
- `passkeys`: `id`, `user_id` (FK cascade), `credential_id` (unique), `public_key` (base64url), `counter`, `transports` (jsonb), `last_used_at` – **Passkeys sind strikt benutzerspezifisch**
- `webauthn_challenges`: `id`, `challenge`, `user_id` (null bei Login), `purpose` (`registration` | `authentication`), `expires_at` – wird nach Verifikation gelöscht

### Storage
- Bucket `item-photos` (public read, Schreiben nur für authentifizierte Nutzer) – Item-Fotos (`items/<uuid>.jpg|png|webp|heic`)

## 4. Auth, Rollen & Sicherheit

**Login-Methoden:**
- **Benutzername + Passwort** (`POST /api/auth/login`) – Benutzername wird auf `{name}@thiel.local` gemappt
- **Passkeys (WebAuthn)** – Fingerabdruck/Face ID. Registrierung nur eingeloggt (`register-options`), Login über discoverable Credentials (`login-options`/`login-verify`). Ein Passkey ist **fest an genau einen Benutzer** gebunden (Credential-ID → `user_id` → Session nur für diesen Nutzer). Session-Erzeugung beim Passkey-Login über Magic-Link-Token.

**Rollen:**
| Rolle | Rechte |
| :--- | :--- |
| `admin` | Alles: Objekte, Foto-Import, OCR, Benutzerverwaltung, Planung, Touren, Item-Fotos |
| `facility_manager` | **Reinigungskraft** (ehem. Objektbetreuer): sieht NUR zugewiesene Objekte (Spalten Name, Adresse, Schlüssel, Kategorie, Items) mit Items in Nur-Lese-Ansicht. Keine Planung, keine Benutzerverwaltung, kein Anlegen/Bearbeiten/Löschen. Zuweisung erfolgt über die Benutzerverwaltung (mind. 1 Objekt). |
| `driver` | Tourenplanung, Pack-Modus, Tour-Modus, Historie (eigene Touren) |
| `substitute` | **Springer**: sieht wie Fahrer alles (Objekte inkl. Zuletzt-beliefert/Info, Planung, Historie) – keine Objektzuweisung nötig, von der Reinigungskraft-Einschränkung unberührt |

**Keine öffentliche Registrierung** – Benutzer werden ausschließlich von Admins über
die Benutzerverwaltung angelegt (`/api/auth/users`, nur `admin`). Seed-Admin „Leon".

**Dreifache Absicherung:**
1. **Middleware** (`src/middleware.ts`): schützt alle Routen außer `/login` + Passkey-Login-APIs. Seiten → Redirect auf `/login?next=…`; API-Routen → `401 UNAUTHENTICATED`
2. **API-Guards**: jede Route prüft `requireUser()` + Rollenprüfung (`isAdmin`/`isPlanner`/`isFacilityManager`), zusätzlich Tour-Owner-Check. **Reinigungskraft:** `/api/objects*` liefert nur zugewiesene Objekte (ohne Letzte-Belieferung-Felder), Item-/Foto-/Pack-Info-Endpunkte sind auf zugewiesene Objekte begrenzt und schreibgeschützt (403)
3. **RLS** in der Datenbank (`auth.uid()` / `current_user_role()`) – Passkeys nur für den Besitzer; `objects`/`object_items` rollenbewusst (Reinigungskräfte nur zugewiesene Zeilen, Schreiben nur Admins); `object_assignments` Admin-verwaltet mit Eigen-Lese-Recht; `time_entries`/`time_off_requests` nutzergebunden (eigene Zeilen + Admin; Freigaben nur durch Admins)

## 5. Kernfunktionen & Workflows

### 5.1 Objektverwaltung (`/objects`)
- CRUD für Objekte (Name, Adresse, Kategorie, Öffnungszeit, Schlüsselnummer) – nur Admins
- **Suche + Sortierung** je Attribut: Name/Adresse (A–Z/Z–A), Schlüssel-Nr. (auf-/absteigend), Kategorie, Items-Anzahl
- **Adress-Autocomplete** per ORS (`/api/geocoding/autocomplete`) + **Verifizierung** beim Speichern (`/api/geocoding/verify`), Stadtteil-Suffixe werden fürs Geocoding normalisiert
- **Fußgängerzone wird beim Speichern automatisch per Overpass erkannt** (keine Checkbox)
- Items je Objekt: Name, Menge, Bemerkung, **Foto-Upload** (`/api/items/photo`, 10 MB)
- **Reinigungskräfte (`facility_manager`):** sehen nur ihre zugewiesenen Objekte. Tabellenspalten auf Name, Adresse, Schlüssel, Kategorie, Items reduziert (kein „Zuletzt am"/„Info"). Der Items-Dialog ist eine reine Lesensicht (keine Bearbeitung, kein Foto-Upload).

### 5.2 Foto-Import (KI, Admin)
Drei Import-Arten über `/api/objects/import/*` (Gemini-OCR):
- **Objekte** (`objects/analyze` + `objects`): abfotografierte Adresslisten → Vorschau mit Duplikat-Erkennung (normalisierte Adresse + Fuzzy-Match), ORS-Geocoding-Status je Eintrag, Fußgängerzonen-Check (OCR-Hinweis **oder** Overpass)
- **Schlüssel** (`keys/analyze` + `keys`): erkannte Schlüsselnummern → Zuordnung zu bestehenden Objekten (Dropdown zeigt vorhandene Schlüsselnummern) oder **„Neues Objekt anlegen…"** (Name/Adresse eingeben, wird geocodiert + Fußgängerzone geprüft, Duplikat-Schutz über bestehende Adressen)
- **Items** (`items/analyze` + `items/import`): Packlisten pro Objekt → Zuordnung zu Objekten (per Adresse/Name) oder Verwerfen; Menge + Bemerkung strukturiert, **je Item per Checkbox als Standard-Item markierbar** (`is_always_required`). Die **Übernahme läuft asynchron im Hintergrund** (`maxDuration = 300`): `POST items/import` nimmt den Auftrag sofort mit `202` an, speichert Objekte + Items über die Next.js-`after()`-Hooks nach/parallel zur Antwort und meldet einen Fehler (z. B. angelegte Objekte, aber Fehler beim Items-Batch) per **Push-Benachrichtigung** (Tag `photo-import-failure`, `always`), sodass die App währenddessen frei bleibt und ein nächster Import parallel starten kann

### 5.3 Tourenplanung (`/planung`)
- **Manuelle Auswahl:** Objekte werden pro Tour manuell ausgewählt (Wochentags-Vorauswahl/-Speichern wurde entfernt). Über der Liste zeigt ein Zähler `ausgewählt/gesamt` (z. B. „5/42“) den Fortschritt
- **Unbekannte Ziele:** Ein einzelner Button „+ Unbekanntes Ziel“ (über der Objektliste) legt ein temporäres Ziel an. Im Dialog wird die Adresse per **Autocomplete** gesetzt – speicherbar ist nur ein ausgewählter Vorschlag (gültige Adresse + Koordinaten); ein Maps-Icon neben dem Eingabefeld öffnet die Adresse als Suche in Google Maps. Neue Ziele erscheinen unter „Unbekannte Ziele (x)“ **ganz oben**, sind automatisch ausgewählt und per Checkbox bzw. Zeilen-Tipp ab-/anwählbar (der Pencil-Button öffnet den Dialog zum Bearbeiten/Löschen). Sie fließen in die Routenberechnung ein, haben kein Item-Fenster, werden im Tour-Modus direkt als „beliefert“ abhakbar angezeigt und in der Historie mit Name + Adresse (ohne Items/Schlüssel) gelistet. Speicherung nur für die aktuelle Tour: Tab-Wechsel erhält sie (sessionStorage), App-Neustart oder Tour-Start löscht sie; bei Neuberechnung bleiben nur ausgewählte Ziele erhalten
- **Foto-Auswahl** (`/api/planning/photo`): abfotografierte Routenliste → Häkchen automatisch setzen (Match per Adresse/Name, Unmatched werden aufgelistet)
- **Startzeit** automatisch (aktuelle Uhrzeit + Vorbereitungszeit, auf 5 Min gerundet) – kein manuelles Auswahlfeld mehr

### 5.4 Routen-Optimierung (`/api/planning/optimize`)
Eingebettet in `src/lib/routing/optimizer.ts`:

1. **Primär: ORS Optimization API (VROOM)** – Jobs mit Zeitfenstern, Fahrzeug vom Lager
   - **Live-Verkehr:** Ist `TOMTOM_API_KEY` gesetzt, wird vorab die **TomTom Routing Matrix** (Custom Matrix) für alle Koordinaten abgefragt und als `matrix`-Feld direkt an VROOM übergeben (Reihenfolge der Koordinaten exakt passend zur Job-/Depot-ID-Zuordnung). Ergebnis: `traffic_matrix_provider: "tomtom"`
   - Grenzen: 100 Orte, 2500 Zellen (Free-Tier), steuerbar über `TOMTOM_MAX_CELLS`
2. **Fallback:** ORS-Matrix → Google-Matrix → Haversine + eigener TSP-Solver (`solveTspWithWindows`)
3. **Zeitfenster:**
   - `opens_at` → **frühester Zeitpunkt** (Ankunft DARF erst danach)
   - Fußgängerzone → **zwei Varianten werden berechnet**: (A) direkt zum Objekt, nur bis 11:00 Uhr möglich (Deadline 11:00); (B) über den per Overpass gesuchten **nächstgelegenen befahrbaren Haltepunkt** (`findNearestDrivablePoint`) + Restweg **zu Fuß** (keine Deadline)
4. **Die schnellere Variante gewinnt:** Die Fußweg-Zeit (≈ 5 km/h) wird beim Vergleich von Variante B berücksichtigt. Bei Variante B zeigt der Stopp „x m zu Fuß" (`approach_by_foot`); ist A nicht machbar, gewinnt B automatisch (sofern ein Haltepunkt gefunden wurde)
5. **Vorbereitungszeit** am Lager: 4 Min/Stopp + 5 Min Schlüssel (`prep_begin` = Abfahrt − Vorbereitung)
6. **Haltzeit je Ziel** nach Kategorie: Treppenhaus 6 Min, Objekt 8 Min (Servicezeit fließt in VROOM/TSP-Solver und Ankunfts-/Abfahrtszeiten ein)
7. Warnungen (z. B. nicht erfüllbare Restriktionen) als `warnings[]`

Ergebnis (`RouteOptimizationResult`): `mode` (`ors-optimization` | `ors-matrix` | `google-matrix` | `haversine`), sortierte Stopps mit Ankunft/Abfahrt, Koordinaten, Gesamtdauer, Lager (`warehouse`). Im **Demo-Modus** (kein ORS-Key) `null`-Koordinaten – keine erfundenen Hash-Koordinaten.

### 5.5 Pack-Modus (`/planung` nach Optimierung)
- Stopp-Timeline mit Ankunftszeiten, **grünes/rotes Status-Badge** („Optimierung erfolgreich" / „Optimierung fehlgeschlagen")
- **Geschätztes Arbeitsende** wird angezeigt (Lager-Rückkehr + Aufräumzeit: 4 Min/Stopp + 5 Min) – bewusst ohne Rechnungsweg
- **Schlüssel-Auswahl:** Ein Button „Schlüssel auswählen“ öffnet einen Dialog mit allen Objekten der Tour und ihren Schlüsselnummern (Checkbox je Objekt, Mehrfachauswahl, Bestätigen schließt). Nach Bestätigung zeigt der Button „Schlüssel: Nr. x, Nr. y, …“ und bleibt zum Nachbessern antippbar. Nur bestätigte Schlüssel werden mit der Tour gespeichert, im Tour-Modus angezeigt und in der Historie unter „Schlüssel mitgenommen“ gelistet
- Klick auf Stopp → **Packliste** (`/api/objects/[id]/pack-info`): Standard-Items + vorgemerkte Extra-Items der letzten Tour; Items mit Foto sind antippbar (Bildansicht); die Item-Liste zeigt oben die Schlüsselnummer („Nr. x“) des Objekts
- **Karte unten** (Leaflet): Rundtour Lager → alle Stopps → Lager inkl. Rückweg, nummerierte Marker, Fußweg-Anteile
- **„Ausfahren beginnen"** → Tour anlegen (`/api/tours`) und in den Tour-Modus wechseln

### 5.6 Tour-Modus (`/tour/[id]`)
- Stopps in optimierter Reihenfolge mit Fortschrittsbalken, **Karte unten** (belieferte Stopps grün mit Häkchen)
- Klick auf Stopp → Item-Liste: Standard-Items fest gecheckt/ausgegraut, variable Items für die **nächste Belieferung** an-/abwählbar (wird als `next_delivery_items` gespeichert)
- Objekt-Stopps zeigen Badge „Nr. x“ mit der im Pack-Modus ausgewählten Schlüsselnummer
- **Unbekannte Ziele** erscheinen ebenfalls (Name + Adresse, nicht antippbar, ohne Item-Dialog) und werden direkt per Check-Button als „beliefert“ markiert
- **„Beliefern fertig"** → Stopp abhaken; alle Stopps fertig → Tour `completed`

### 5.7 Historie (`/historie`)
- Vergangene Touren mit Datum, Fahrer, Anzahl belieferter Stopps und belieferten Objekten (`GET /api/tours`)
- **Unbekannte Ziele** werden als eigene Sektion mit Name + Adresse angezeigt (ohne Items/Schlüssel); Schlüsselnummern der Tour erscheinen unter „Schlüssel mitgenommen“; die Suche deckt Namen/Adressen unbekannter Ziele ab

### 5.8 Chat (`/chat`)
- Kontaktliste mit Suche, Rollenfilter und Admin-Broadcast an mehrere Mitarbeiter
- Nachrichten mit Text, Bild- und Audioanhängen, Eilmeldungen, Statushaken, Uhrzeit und Übersetzung
- Thread-Ansicht ist auf mobilen Geräten als Master-Detail-Navigation umgesetzt: Liste oder Verlauf, mit Zurück-Navigation
- Eigene Nachrichten sind rechts als blaue Bubbles mit maximal 75 % Breite, empfangene Nachrichten links neutral dargestellt; der aktive Kontakt ist in der Liste markiert
- Offline-First: Nachrichten werden lokal in IndexedDB zwischengespeichert bzw. aus der Upload-Warteschlange synchronisiert; der Thread-Index und Batch-Schreibvorgänge reduzieren die Ladezeit
- Push-Benachrichtigungen sind optional und werden nur nach Browser-Zustimmung eingerichtet. Das Push-Payload unterstützt ein optionales Flag `always` (Service Worker `sw.js`): Ist es gesetzt, wird die Benachrichtigung auch angezeigt, wenn ein Tab der App gerade sichtbar ist (Standard ist, dann zu unterdrücken). Wird u. a. für den Foto-Import-Fehler genutzt.

### 5.9 Einstellungen (`/einstellungen`)
- Profil (Name), Passwort ändern (`/api/auth/me-password`), **Passkeys verwalten** (registrieren/löschen, eigene nur)
- **Benutzerverwaltung (Admin):** Konten anlegen, Rollen vergeben, **Vertragsart** (Vollzeit/Teilzeit/Minijob/Individuell – bestimmt das Soll im Überstundenkonto)
- **Vertrags-Auto-Fill:** Die Vertragsart befüllt Soll-Stunden, Arbeitstage und Urlaubstage automatisch (Vollzeit 40/5/30, Teilzeit 20/5/30, Minijob 10/2/12); `custom` („Individuell“) blendet **Soll-Stunden/Woche** und **Arbeitstage/Woche** ein, der Urlaubsanspruch wird beim Ändern der Arbeitstage als `round(30 × Arbeitstage ÷ 5)` vorgeschlagen. **`vacation_days_per_year` bleibt in allen Vertragsarten manuell anpassbar.** Bei bestehenden Nutzern öffnet die Wahl „Individuell“ einen Dialog mit den drei Feldern; der Wechsel auf Vollzeit/Teilzeit/Minijob übernimmt die Auto-Fill-Werte serverseitig und **Objekte zuweisen** – beim Anlegen einer Reinigungskraft erscheint die Objektauswahl (Pflicht, mind. 1); bestehende Reinigungskräfte haben einen „Objekte"-Button zum Nachbearbeiten der Zuweisung

### 5.10 Zeiterfassung & Urlaubsverwaltung
**Stempeluhr (auf allen Seiten sichtbar):** ClockWidget im Header (Desktop) bzw. in der unteren Leiste (Handy). Ein-/Ausstempeln, Pausen-Toggle + feste Pausen-Presets (+15/30/45/60 Min.), Live-Zähler, Browser-Erinnerung „Vergessen auszustempeln?“ (nach 8 h oder ab 17:00 Uhr mit ≥ 1 h, einmalig je Stempelung). **Offline-First** über IndexedDB + LWW (`client_updated_at`, Serverzeit-Ausrichtung via `nowServerAligned`).

**Mitarbeiter-Dashboard (`/zeiterfassung`):**
- Wochen-/Monatssummen und **Überstundenkonto** (automatischer Soll/Ist-Vergleich auf Basis von **`weekly_target_hours`** aus dem Profil – Vollzeit 40 / Teilzeit 20 / Minijob 10 h, bei `custom` der individuelle Wert; nur freigegebene, abgeschlossene Einträge und abgeschlossene Wochen) + manuelle Admin-Korrektur; **Resturlaub-Anzeige = `vacation_days_per_year − vacation_days_used`**
- **Arbeitszeit nachreichen** (vergessene Stempelung) → Eintrag mit `source = submitted`, `is_approved = false` → wartet im Freigabe-Feed
- **Abwesenheitsanträge** (Urlaub, Krankheit, unbezahlt, Freizeitausgleich) mit Status-Anzeige

**Auto-Timeout & Prüfbedarf (vergessene Ausstempelung):**
- Überschreitet eine offene Stempelung **12 h** oder erreicht **Mitternacht (00:00, Europa/Berlin)** → automatisch `requires_review = true` + `is_approved = false` (DB-Trigger bei Schreibvorgängen, Housekeeping `flag_overdue_time_entries` bei jedem Zugriff)
- Solche Einträge fließen **nicht** in Wochen-/Monatssummen oder das Überstundenkonto, bis sie freigegeben sind
- **Zwangspopup beim App-Start:** Für ungelöste, noch offene Prüfbedarf-Einträge erscheint ein **nicht-schließbares** Popup mit tatsächlicher Endzeit, Pause und Notiz (`PATCH /api/time-tracking/entries/[id]`). Absenden schließt den Eintrag (`source = submitted`) → „Nachgereicht / Warten auf Freigabe“. Kein Popup mehr, sobald der Eintrag geschlossen oder vom Admin freigegeben ist; erneute Prüfung bei Tab-Fokus

**Pausen-Automatik (§ 4 ArbZG):** Anwesenheitszeit **> 6 bis 9 Std. → mindestens 30 Min. Pause, > 9 Std. → mindestens 45 Min.** Die erfasste Pause wird automatisch auf das Minimum ergänzt (nie reduziert) – DB-Trigger deckt alle Schreibpfade ab (Stempeluhr, Offline-Sync, Nachreichung, Admin-Korrektur). Netto-Arbeitszeit = `(clock_out − clock_in) − Pause` (`workedMinutesOf`). Unterschreitet die gewählte Pause das Minimum, zeigen **Ausstempeln-Dialog (Zeitadmin)** und **Zwangspopup** den Hinweis *„Gemäß § 4 ArbZG wurden automatisch X Minuten Mindestpause berücksichtigt.“*

**Zeitadmin (`/admin/zeiterfassung`):**
  - **Prüfbedarf-Sektion:** alle offenen, markierten Stempelungen mit live zählender Dauer seit Einstempeln; Aktionen „Ausstempeln & Freigeben“ (Endzeit, Pause, Notiz, optionales Feld „Grund der Änderung“ – schließt, erzwingt die ArbZG-Mindestpause und setzt `is_approved = true`) und „Löschen“
  - **Freigabe-Feed:** geschlossene, noch nicht freigegebene Stempelungen („Nachgereichte Arbeitszeit“ / „Vergessene Ausstempelung“) und offene Anträge – einheitlich mit Icon + Status-Badge („Ausstehend“)
  - **Freigabe löst den Fall:** `is_approved = true` + `requires_review = false` → Eintrag zählt danach in Summen und Konto
  - **Änderungsprotokoll (Audit Log):** Jede Admin-Anpassung/-Freigabe/-Löschung einer Stempelung wird revisionssicher in `time_entry_audit_logs` protokolliert (alt→neu-Snapshot, Bearbeiter, Zeitstempel, Grund – bei Offline-Änderungen „Offline-Änderung (Sync)“). Auch **Nachreichungen durch den Mitarbeiter** werden protokolliert („Vergessene Ausstempelung nachgereicht“ / „Arbeitszeit nachgereicht“ – offline mit Zusatz „(Offline)“). Bearbeitete Einträge zeigen ein **Historiensymbol (🕘)** mit Tooltip *„{Begründung} von X am DD.MM.YYYY um HH:MM“* (z. B. *„Vergessene Ausstempelung nachgereicht von Max am 08.08.2026 um 14:32 Uhr“*); Klick öffnet einen Dialog mit allen Änderungen inkl. Feld-Diff (Start/Ende/Pause/Freigabe/Prüfbedarf/Notiz)
  - Mitarbeiterstatus („Aktiv“ / „Prüfbedarf“), Monatsübersicht, Lohn-CSV-Export, Konto-Korrekturen (Urlaub/Überstunden) sowie aktive Tour/nächstes Objekt in der Statusübersicht. Der Umzug der Suche vom Server an den Client: Die Übersicht `GET /api/admin/time-tracking/overview` liefert alle Mitarbeiter, die Mitarbeiterstatus-Liste filtert per **Client-seitiger Suche** (`statusEmployeeQuery`); der Abwesenheitskalender bietet zusätzlich einen **Mitarbeiter-Suchfilter** (Suchfeld im Filter-Dropdown) neben den bestehenden Filtern für Abwesenheitstypen und Rollen

## 6. Offline-First und Synchronisation

- Synchronisierbare Tabellen: `objects`, `object_items`, `inventory_items`, `active_tours`, `tour_stops`, `profiles`, `time_entries` und `time_off_requests`.
- Offline-Schreibvorgänge werden in IndexedDB als `pending_upload` gespeichert und beim Reconnect über `POST /api/sync` synchronisiert. Last-Write-Wins verwendet `client_updated_at`; bei Konflikten übernimmt der Client den Server-Datensatz. Die Serverzeit wird über `GET /api/time` an die Client-Uhr angeglichen.
- Die Sync-Engine synchronisiert in Abhängigkeitsreihenfolge (Touren vor Tourstopps), verarbeitet Batches und schützt lokale Änderungen, die während eines laufenden Syncs entstanden sind.
- Löschen, Foto-/OCR-Import, Authentifizierung, Passwort-/Passkey-Verwaltung und Benutzeranlage bleiben online-only. Lesbare Daten werden je nach Endpunkt aus IndexedDB bereitgestellt; der Service Worker cached die App-Shell, greift aber nicht in `/api/*` ein.
- Schlüssel-Auswahl und unbekannte Ziele sind offline voll funktionsfähig: Der Sync-Whitelist für `tour_stops` sind die Felder `key_number`, `is_unknown` und die unbekannt-Ziel-Spalten bekannt; die Offline-Historie/Tour-Ansicht rekonstruiert sie aus dem Cache. Das Adress-Autocomplete braucht für neue Vorschläge hingegen eine Online-Verbindung.
- Performance: Cache-Schreibvorgänge laufen als Batch in je einer Lese- + Schreib-Transaktion pro Tabelle (statt zwei Transaktionen je Zeile); die Offline-Queue liest pending-Einträge über einen `sync_status`-Index (IndexedDB v6); der Historie-/Tour-Assembler gruppiert Stopps einmalig pro `tour_id` statt eines Vollscans je Tour.
- Der Sync-/Offline-Indikator zeigt Online-/Offline-Status, laufende Synchronisierung, offene Einträge, letzten Sync und Fehler an.

## 7. Karten (Leaflet)
- `src/components/map/route-map.tsx` – imperatives Leaflet (nur im `useEffect`, SSR-sicher), OSM-Kacheln (kostenlos)
- Straßenverlauf per **ORS-Directions** (`POST /api/planning/route-geometry`, Bearer-Auth, Polyline-Decoder in `src/lib/polyline.ts`); Fallback: gestrichelte Luftlinien
- Eingesetzt im Pack-Modus und in der Tour-Ansicht; Autofit auf alle Punkte

## 8. API-Übersicht (alle geschützt, Rolle in Klammern)

**Auth:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me-profile` · `POST /api/auth/me-password`
**Passkeys:** `POST /api/auth/passkeys/login-options` (öffentlich) · `login-verify` (öffentlich) · `register-options` · `register-verify` · `DELETE /api/auth/passkeys/[id]`
**Benutzer (Admin):** `GET/POST /api/auth/users` · `PATCH/DELETE /api/auth/users/[id]`
**Geocoding:** `POST /api/geocoding/autocomplete` · `POST /api/geocoding/verify`
**Objekte (Admin; Facility lesend):** `GET/POST /api/objects` · `GET/PATCH/DELETE /api/objects/[id]` · `GET/POST /api/objects/[id]/items` · `PATCH/DELETE /api/objects/[id]/items/[itemId]` · `GET /api/objects/[id]/pack-info`
**Inventar (Admin):** `GET/POST /api/inventory` · `PUT/DELETE /api/inventory/[id]`
**Import (Admin):** `POST /api/objects/import/objects[/analyze]` · `…/keys[/analyze]` · `…/items[/analyze]` · `POST /api/objects/import/items/import` (Items-Übernahme asynchron, `202`, Ergebnis/Fehler per Push)
**Items:** `POST /api/items/ocr` · `POST /api/items/photo` (alle außer Reinigungskräfte)

**Objektzuweisungen (Admin):** verwaltet über `PATCH /api/auth/users/[id]` bzw. `POST /api/auth/users` (`object_ids`, mind. 1 bei Reinigungskräften); Vertragsart über `contract_type` (GET/POST/PATCH) – zusätzlich `weekly_target_hours`, `working_days_per_week`, `vacation_days_per_year` (Auto-Fill-Defaults serverseitig, Validierung Sollstunden 0–168 h / Arbeitstage 1–7 / Urlaubstage 0–365)
**Planung (Driver/Admin):** `GET /api/planning` · `POST /api/planning/optimize` · `POST /api/planning/photo` · `POST /api/planning/route-geometry`
**Touren (Driver/Admin):** `GET/POST /api/tours` · `GET/PATCH/DELETE /api/tours/[id]` · `PATCH /api/tours/[id]/stops/[stopId]`
**Zeiterfassung (angemeldet):** `GET/POST /api/time-tracking/clock` · `GET/POST /api/time-tracking/entries` · `PATCH /api/time-tracking/entries/[id]` (Nachreichung vergessener Ausstempelung) · `GET /api/time-tracking/review` (Prüfbedarf-Abfrage fürs Zwangspopup) · `GET /api/time-tracking/summary` · `GET/POST /api/time-tracking/requests` · `PATCH /api/time-tracking/requests/[id]`
**Zeitadmin (Admin):** `GET /api/admin/time-tracking/overview` (inkl. `audit_logs` je Eintrag) · `GET /api/admin/time-tracking/status` · `GET /api/admin/time-tracking/export` (Lohn-CSV) · `POST /api/admin/time-tracking/entries` · `PATCH/DELETE /api/admin/time-tracking/entries/[id]` (Freigabe + offene Stempelung aktiv schließen; ArbZG-Mindestpause; schreibt `time_entry_audit_logs`)

## 9. Umgebungsvariablen (`.env.local`)

| Variable | Pflicht | Zweck |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase-Client & Middleware |
| `ORS_API_KEY` | ✅ | Geocoding, Directions, VROOM-Optimierung (Premium-Key = JWT → `Bearer`, sonst `apikey`) |
| `TOMTOM_API_KEY` | – | Live-Verkehrs-Matrix (Custom Matrix für VROOM); ohne → Standard-Fahrzeiten |
| `TOMTOM_MAX_CELLS` | – | Limit der Matrix-Zellen (Default 2500) |
| `GOOGLE_MAPS_API_KEY` | – | Optionaler Matrix-Fallback |
| `GEMINI_API_KEY` | – | OCR (Foto-Import) |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` | – | Passkey-Relaying-Party (Default: Host / „Thiel Dienstleistungen") |
| `WAREHOUSE_ADDRESS` | – | Lager-Adresse (Default: Sartoriusstraße 14, 97072 Würzburg) |

## 10. Projektstruktur (Auszug)

```
src/
  middleware.ts                     # Session-Refresh + Seiten-/API-Schutz
  app/page.tsx                      # Redirect → /objects
    login/ · objects/ · inventar/ · planung/ · tour/[id]/ · historie/ · chat/ · einstellungen/
                                    · zeiterfassung/ · admin/zeiterfassung/
  api/                              # auth, users, passkeys, geocoding, items,
                                    # objects (inkl. import/*), inventory, planning,
                                    # tours, chat, time-tracking (+ admin/time-tracking)
  components/
    app-shell.tsx                   # Header-Navigation (rollenabhängig)
    map/route-map.tsx               # Leaflet-Route
    objects/                        # Objektverwaltung + Foto-Import-Dialoge
    inventory/                      # Inventar (Item-Katalog, Admin)
    planning/                       # Planung, Pack-Modus, Foto-Auswahl
    tour/                           # Tour-Modus, Liefer-Dialog
    chat/                           # Kontaktliste, Thread-Verlauf, Medien, Push, Offline-Queue
    time-tracking/                  # Stempeluhr, Zeiterfassung, Zeitadmin, Prüfbedarf-Popup
    settings/ · history/ · auth/ · ui/
  lib/
    auth.ts                         # requireUser, Rollen, Username↔Email
    ors.ts · overpass.ts · ocr.ts · traffic-matrix.ts · warehouse.ts · polyline.ts
    time-tracking.ts                # Profil-Referenzen, flagOverdueTimeEntries (Housekeeping),
                                    # logTimeEntryChange + auditSnapshotOf (Audit-Log)
    contract.ts · time-format.ts    # Soll/Ist, Überstundenkonto, Zeit-Formatierung,
                                    # requiredBreakMinutes/enforcedBreakMinutes (§ 4 ArbZG)
    offline/                        # db, fetch (offlineFetch), sync, clock (Serverzeit-Offset), chat
    routing/optimizer.ts            # VROOM + Matrix + TSP + Zeitfenster
    routing/tsp.ts · time.ts
    supabase/                       # server/admin/middleware-Client
    webauthn.ts                     # Passkey-Verifikation
supabase/migrations/                # versionierte Schema- und Performance-Migrationen
```

## 11. Entwicklung

- `npm run dev` – Dev-Server · `npm run build` – Produktions-Build · `npm run typecheck` – `tsc --noEmit` · `npm start` – Produktions-Server
- Overpass: Antworten werden serverseitig 24 Stunden im Memory gecacht; für Würzburg existiert ein lokaler Polygon-Fallback. Bei Cache-Miss werden beide Overpass-Endpunkte mit Timeout/Retry verwendet.
- Offline-Time-Entries: Pending-Einträge werden chronologisch synchronisiert. Konflikte am partiellen Unique-Index werden serverseitig als LWW-Konflikt mit dem offenen Server-Eintrag beantwortet, damit die Queue nicht dauerhaft blockiert.
- Passkey-Login: `generateLink`/`verifyOtp` erzeugen und verwenden intern ein Token; es wird kein E-Mail-Versand ausgelöst. Der Ablauf bleibt serverseitig und kann über die Login-Request-Dauer gemessen werden.

- Migrationen werden in `supabase/migrations/` versioniert (laufen auf dem Supabase-Projekt); der Chat benötigt die Chat-, Push- und Performance-Migrationen bis `20260825000000_chat_performance.sql`
- **Passwortloser Supabase-CLI-Ablauf:** Dieses Projekt ist bereits mit einem Supabase-Projekt verknüpft (`supabase/.temp/project-ref`). Wenn die CLI-Sitzung bereits authentifiziert ist, prüft `supabase projects list` den Zugriff ohne ein DB-Passwort. Migrationen werden anschließend mit `supabase db push --linked --yes` eingespielt. Die CLI verwendet dabei die bestehende lokale Login-/Access-Token-Sitzung; ein Datenbankpasswort muss nicht in Dateien gespeichert werden. Falls `supabase projects list` nicht funktioniert, zuerst einmalig interaktiv `supabase login` ausführen (Token aus dem Supabase-Dashboard), danach erneut `supabase db push --linked --yes`. Migrationen mit identischer Versionsnummer dürfen nicht existieren; die Springer-Migration verwendet deshalb `20260828000200_substitute_requests.sql`.
- Deployment über Git-Push nach `main` (Vercel/GitHub Actions), Migrationen vor dem ersten Request einspielen
