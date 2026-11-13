# Firmen-App (RAW_DE) – Systemspezifikation

Liefer- & Tourenplanungs-App (mobile-first Web-App), deutschsprachige und
firmenunabhängige Vorlage. Dieses Dokument beschreibt den **aktuellen Stand des
Codes** in `RAW_DE/` (Stand: November 2026).

---

## 1. Überblick

Die App unterstützt den kompletten Arbeitstag einer Liefer-/Service-Rundtour:

1. **Objekte verwalten** (Kundenstandorte, Treppenhäuser) inkl. Items, Schlüsselnummern, Bemerkungen und Fotos
2. **Touren planen** – manuelle Auswahl, Foto-Auswahl, optimierte Rundtour vom/zum Lager
3. **Packen** – konsolidierte Packlisten je Objekt, Route auf der Karte
4. **Ausliefern** – Stopps in optimierter Reihenfolge, Items vorab geprüft, Belieferung abhaken (oder als nicht lieferbar schließen)
5. **Historie & Einstellungen** – vergangene Touren, Profil, Passwort, Passkeys
6. **Zeiterfassung & Abwesenheitsverwaltung** – Stempeluhr, nachgereichte Arbeitszeit, Abwesenheitsanträge, Vertretung, Zeitadmin mit Prüfbedarf (Auto-Timeout für vergessene Ausstempelungen)
7. **Chat** – Mitarbeiter-/Admin-Kommunikation mit Medien, Eilmeldungen, Transkription, Übersetzung, Push und Offline-Unterstützung

Der Ablauf ist als **Rundtour** modelliert: Start und Ziel sind immer das Lager
(`NEXT_PUBLIC_WAREHOUSE_NAME` / `WAREHOUSE_ADDRESS`). Anders als die
Firmenvariante `THIEL` enthält `RAW_DE` **keinen Firmennamen, kein festes Lager
und kein festes Einsatzgebiet** – alle diese Werte kommen aus
Umgebungsvariablen, sodass derselbe Code ohne Änderungen von einer anderen Firma
übernommen werden kann.

---

## 2. Tech-Stack & Architektur

| Ebene | Technologie | Zweck |
| :--- | :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, shadcn/ui (Radix), lucide-react, sonner | Mobile-optimierte UI, Server Components + Client-Komponenten |
| **Backend / DB** | Supabase (PostgreSQL + Auth + Storage), `@supabase/ssr` | Datenmodell, Sessions, RLS, Storage-Bucket für Item-Fotos |
| **Auth** | Supabase Auth (Passwort) + WebAuthn-Passkeys (`@simplewebauthn`) | Login per Benutzername/Passwort **und** Fingerabdruck/Face ID |
| **Routen-Optimierung** | ORS Optimization API (VROOM) mit Custom-Matrix | Optimale Rundtour unter Zeitfenstern & Restriktionen |
| **Live-Verkehr** | TomTom Routing Matrix API, alternativ Stadia-Maps-Matrix | Aktuelle Fahrzeiten (inkl. Stau) als VROOM-Custom-Matrix |
| **Geocoding** | OpenRouteService Geocode Search, Photon als Fallback | Adress-Autocomplete & Koordinaten-Verifizierung |
| **Fußgängerzonen** | Overpass API (OpenStreetMap) | Automatische Erkennung + nächster befahrbarer Haltepunkt |
| **Karten** | Leaflet (imperativ, ohne react-leaflet), OSM-Tiles, ORS-Directions | Routen-Geometrie in Pack- & Tour-Modus |
| **OCR / Vision** | Gemini Vision API | Erkennung von abfotografierten Listen (Objekte, Schlüssel, Items) und Audio-Transkription |
| **Routen-Fallback** | ORS-Matrix → Google-Matrix → Haversine + eigener TSP-Solver | Optimierung läuft auch ohne Primär-API |
| **Deployment** | OpenNext-Adapter + Wrangler (`freebuff.wrangler.jsonc`, `freebuff.open-next.config.ts`) | Cloudflare Workers / Freebuff Sites |

---

## 3. Konfiguration

Alle Firmen- und Regionswerte kommen aus Umgebungsvariablen (siehe
`.env.local.example`). `NEXT_PUBLIC_*`-Werte werden beim **Build** in den Code
eingetragen und sind auch im Browser sichtbar; eine Änderung danach erfordert
einen neuen Build.

| Variable | Pflicht | Wirkung |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_COMPANY_NAME` | – | Name in Header, Login, Seitentitel, Passkey (Default `Musterfirma`) |
| `NEXT_PUBLIC_COMPANY_SLUG` | – | Kurzform für Dateinamen (Lohnexport); Default aus dem Namen abgeleitet |
| `NEXT_PUBLIC_USER_EMAIL_DOMAIN` | – | Interne Login-Domain: Benutzer `max` wird zu `max@<domain>` (Default `company.local`) |
| `NEXT_PUBLIC_WAREHOUSE_NAME` | – | Name des Lagers (Default: Firmenname) |
| `WAREHOUSE_ADDRESS` / `NEXT_PUBLIC_WAREHOUSE_ADDRESS` | – | Lageradresse (Start/Ziel der Rundtour); Default `Musterstraße 1, 12345 Musterstadt` |
| `NEXT_PUBLIC_SERVICE_CITY` | – | Stadt für Adressen ohne Ortsangabe; leer = keine Stadt ergänzen |
| `NEXT_PUBLIC_SERVICE_CITY_LAT` / `_LON` | – | Standort-Bias der Geocoding-Suche |
| `NEXT_PUBLIC_SERVICE_AREA_BOUNDARY` | – | Suchgrenze `minLon,minLat,maxLon,maxLat` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase-Client & Middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Nur serverseitig (API-Routen), nie im Frontend |
| `ORS_API_KEY` | empfohlen | Geocoding, Directions, VROOM-Optimierung (Premium-Key = JWT → `Bearer`, sonst `apikey`) |
| `TOMTOM_API_KEY` | – | Live-Verkehrs-Matrix (Custom Matrix für VROOM) |
| `TOMTOM_MAX_CELLS` | – | Limit der Matrix-Zellen (Default 2500) |
| `STADIA_API_KEY` | – | Alternativer Live-Verkehrs-Matrix-Anbieter |
| `GOOGLE_MAPS_API_KEY` | – | Optionaler Matrix-Fallback |
| `GEMINI_API_KEY` | – | OCR (Foto-Import) und Chat-Transkription |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` | – | Passkey-Relaying-Party (Default: Host / Firmenname) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | – | Web-Push für Chat- und Vertretungs-Benachrichtigungen |

**Einsatzgebiets-Regel:** Ist ein Einsatzgebiet konfiguriert, gelten Adressen
ohne Ortsangabe als zu diesem Gebiet gehörend (Stadt ergänzt, Suche begrenzt).
Ohne Konfiguration arbeitet die App ortsunabhängig.

**Fußgängerzonen-Fallback:** `PEDESTRIAN_FALLBACK_POLYGONS` in
`src/lib/region.ts` kann lokale Polygone aufnehmen, die genutzt werden, wenn
Overpass nicht erreichbar ist (standardmäßig leer).

---

## 4. Datenmodell (Supabase/PostgreSQL)

**Enums:** `user_role` (`driver` | `admin` | `facility_manager` | `substitute`),
`contract_type` (`full_time` | `part_time` | `mini_job` | `custom`),
`object_category` (`objekt` | `treppenhaus`),
`tour_status` (`packing` | `in_transit` | `completed`),
`time_entry_source` (`clock` | `submitted`),
`time_off_type` (`vacation` | `sick_leave` | `unpaid` | `compensatory`),
`time_off_status` (`pending` | `approved` | `rejected`),
`chat_message_kind` (`text` | `image` | `audio`),
`chat_message_status` (`sent` | `delivered` | `read`).

### `profiles` – Benutzerprofile (1:1 zu `auth.users`)
- `id` (PK → `auth.users`, cascade), `name`, `role` (Default `driver`), `email`, `phone`, `created_at`, `updated_at`
- `contract_type` – steuert das Soll im Überstundenkonto
- `weekly_target_hours` (Default 40) – Wochen-Sollstunden (Auto-Fill: Vollzeit 40 / Teilzeit 20 / Minijob 10)
- `working_days_per_week` (Default 5) – geplante Arbeitstage (5/5/2; Basis für den Urlaubsanspruch)
- `vacation_days_per_year` (Default 30) – individuelle Jahresurlaubstage; Rest = `per_year − used`
- `vacation_days_total`, `vacation_days_used`, `overtime_hours` (manuelle Korrektur)
- `chat_preferred_language` – persönliche Übersetzungssprache
- LWW-Felder `client_updated_at`, `synced_at`
- Trigger `on_auth_user_created` legt das Profil bei Auth-Registrierung automatisch an (inkl. Vertrags-Defaults)
- **Login-Kennung:** Benutzername wird auf `{name}@<NEXT_PUBLIC_USER_EMAIL_DOMAIN>` gemappt

### `time_entries` – Arbeitszeit-Stempelungen
- `id`, `user_id` (FK `auth.users`, cascade), `clock_in`, `clock_out` (nullable), `break_duration_minutes` (Default 0), `note`
- `is_approved` (Default true) – Freigabestatus; `requires_review` (Default false) – Prüfbedarf (vergessene Ausstempelung)
- `source` (`clock` = Stempeluhr, `submitted` = nachgereichte Arbeitszeit)
- **Maximal EIN offener Eintrag pro Nutzer** (partieller Unique-Index `WHERE clock_out IS NULL`)
- LWW-Felder + `updated_at`-Trigger
- **Auto-Timeout-Trigger `set_time_entry_review_flag`:** Offene Stempelungen, die **12 h** überschreiten ODER **Mitternacht (00:00, Europa/Berlin)** erreichen, werden `requires_review = true` + `is_approved = false`; normales Ausstempeln bzw. Admin-Freigabe setzt das Flag zurück
- Housekeeping-Funktion `flag_overdue_time_entries()` markiert „im Stillen“ überfällige Einträge (läuft bei jedem Lese-/Schreibzugriff auf Zeitdaten)
- **Min-Pausen-Trigger `enforce_min_break` (§ 4 ArbZG):** Bei jedem Schreibvorgang mit `clock_out` wird die Anwesenheitszeit geprüft und die erfasste Pause auf das gesetzliche Minimum ergänzt – **> 6 bis 9 Std. → 30 Min., > 9 Std. → 45 Min.** (nie reduziert). Backfill hebt Bestandsdaten an. Netto-Arbeitszeit = `(clock_out − clock_in) − break_duration_minutes`

### `time_entry_audit_logs` – revisionssicheres Änderungsprotokoll
- `id`, `time_entry_id` (FK, `on delete set null` – das Protokoll überlebt das Löschen), `changed_by_user_id` (FK, `on delete set null`)
- `changed_at`, `old_values` / `new_values` (jsonb), `change_reason`
- Wird **serverseitig** geschrieben, wenn ein Admin eine Stempelung im Zeitadmin anpasst, schließt, freigibt oder löscht (inkl. Offline-Änderungen via `/api/sync`) – **und** wenn ein Mitarbeiter eine vergessene Ausstempelung nachreicht oder Arbeitszeit nachträglich einreicht; No-op-Updates werden übersprungen
- RLS: Lesen nur für Admins; Schreiben nur über die Service-Rolle

### `time_off_requests` – Abwesenheitsanträge
- `id`, `user_id` (FK cascade), `type`, `start_date`, `end_date`
- `status`, `reviewer_note`, `employee_note`
- `substitute_id`, `substitute_request` (boolean), `substitute_kind` (`driver` | `facility_manager`), `substitute_object_id`
- Springer-Vorschläge werden mit `substitute_request = true` und `status = pending` gespeichert; Admin-Freigabe macht sie aktiv
- LWW-Felder; Trigger verbuchen genehmigte Urlaubstage auf das Konto: `calculate_time_off_workdays(user, start, end)` zählt Montag–Freitag und skaliert proportional zu `working_days_per_week`; `recalculate_vacation_days_used(user)` summiert nur **genehmigte** Urlaubsanträge des **aktuellen Kalenderjahres**, gekappt auf `[Jahresanfang, Jahresende]`
- Trigger `sync_vacation_days_used` bei Insert/Update/Delete sowie bei Änderung von `working_days_per_week`; die früheren kalendertagebasierten Trigger wurden entfernt

### `objects` – Ziele/Treppenhäuser
- `id`, `name`, `address`, `category`
- `is_pedestrian_zone_until_11` – Fußgängerzone (per Overpass erkannt, keine manuelle Checkbox): direktes Anfahren nur bis 11:00 Uhr, sonst über den nächsten befahrbaren Haltepunkt + Fußweg
- `opens_at` (time, nullable) – **DARF erst ab dieser Uhrzeit angefahren werden**
- `latitude`, `longitude` (ORS-verifizierte Koordinaten, nullable)
- `key_number` (integer, nullable)
- `customer`, `customer_number`, `cleaning_interval` – **nur für Admins** sichtbare Infos
- `remark` – für alle Rollen sichtbar, nur von Admins bearbeitbar (z. B. Zugangshinweise)
- `last_delivery_at`, `last_delivery_driver_name`, `last_delivery_items` (jsonb) – gesetzt beim Abschluss einer Tour
- LWW-Felder

### `object_assignments` – Objektzuweisungen (m:n Benutzer ↔ Objekt)
- `user_id` (FK cascade), `object_id` (FK cascade), `created_at`; PK `(user_id, object_id)`
- Steuert die Sichtbarkeit für **Reinigungskräfte** (`facility_manager`): Sie sehen nur zugewiesene Objekte und deren Items – online wie offline. Beim Anlegen einer Reinigungskraft ist mindestens eine Zuweisung Pflicht.

### `object_items` – Items eines Objekts
- `id`, `object_id` (FK cascade), `item_name`
- `is_always_required` – fest ausgewählt & ausgegraut im Pack-/Tour-Modus
- `quantity` (Default 1), `note`, `photo_path` (Storage)
- `is_reserved` – einmalige Vormerkung für die nächste Belieferung (wird nach Belieferung zurückgesetzt)
- LWW-Felder; kein Unique-Constraint auf `(object_id, item_name)`

### `inventory_items` – Inventar (Item-Katalog, nur Admin)
- `id`, `name`, `note`, `created_at`, `updated_at`
- RLS: Lesen für alle authentifizierten Nutzer, Verwalten (anlegen/bearbeiten/löschen) nur für Admins
- Seed: initiale Item-Liste

### `chat_threads`, `chat_messages`, `chat_translations` – Kommunikation
- `chat_threads` verbindet jeweils einen Mitarbeiter mit einem Admin; pro Teilnehmerpaar genau ein Thread
- `chat_messages`: Text, Bild und Audio mit Status `sent`/`delivered`/`read`, `is_urgent`, `transcript`, `media_path`, `media_mime_type`
- `chat_translations` cached Übersetzungen je Nachricht und Zielsprache
- Storage-Bucket `chat-media` ist privat; Medien werden per kurzlebiger Signed URL ausgeliefert
- Realtime-Publication umfasst Threads, Nachrichten und Übersetzungen; die Summary-Abfrage liefert Kontakte, Threads und ungelesene Anzahl

### `push_subscriptions` & `company_settings`
- `push_subscriptions` speichert Web-Push-Endpunkte je Benutzer; ungültige Endpunkte werden beim Versand entfernt
- `company_settings` enthält die optionale zentrale Support-Telefonnummer (Anruf-Button im Chat)

### `active_tours` + `tour_stops` – Touren
- `active_tours`: `id`, `driver_id`, `date`, `status` (`packing` → `in_transit` → `completed`), `start_time`, `warehouse_arrival` (geplante Rückkehr ins Lager), `total_duration_minutes`
- `tour_stops`: `id`, `tour_id` (FK cascade), `object_id` (**nullable** für temporäre Ziele), `stop_order` (unique je Tour), `arrival_time`, `is_delivered`, `key_number` (explizit im Pack-Modus ausgewählt), `next_delivery_items` (jsonb – vorgemerkte Items für die **nächste** Belieferung), `delivered_items` (jsonb-Snapshot der tatsächlich gelieferten Items)
- **Nicht lieferbare Stopps:** `is_undeliverable` (bool) + `undeliverable_reason` (text) – ein Stopp kann ohne Belieferung geschlossen werden (Objekt zu, Zutritt verweigert, Schlüssel fehlt). Belieferung und „nicht lieferbar“ schließen sich gegenseitig aus; die bestehenden Trigger (Letzte-Belieferung, `is_reserved`-Reset) greifen nur bei echter Belieferung
- **Temporäre/unbekannte Ziele:** `is_unknown`, `unknown_target_id` (Client-ID), `unknown_name`, `unknown_address`, `unknown_latitude`, `unknown_longitude` – Snapshots nur des Tour-Stopps, kein `objects`-Eintrag, nur für diese Tour sichtbar (inkl. Historie), beim Löschen der Tour bzw. bei Neuberechnung ohne Auswahl entfernt
- Trigger `update_last_delivery_on_tour_completed` schreibt beim Tour-Abschluss `last_delivery_*` in die Objekte; Trigger `reset_reserved_items_after_delivery` leert `is_reserved`

### Passkeys & Challenges
- `passkeys`: `id`, `user_id` (FK cascade), `credential_id` (unique), `public_key` (base64url), `counter`, `transports` (jsonb), `last_used_at` – strikt benutzerspezifisch
- `webauthn_challenges`: `id`, `challenge`, `user_id` (null bei Login), `purpose` (`registration` | `authentication`), `expires_at` – wird nach Verifikation gelöscht

### Storage
- `item-photos` (public read, Schreiben nur für authentifizierte Nutzer) – Item-Fotos (`items/<uuid>.jpg|png|webp|heic`), max. 10 MB pro Upload
- `chat-media` (privat) – Chat-Bilder und -Audios, Auslieferung über Signed URLs

---

## 5. Auth, Rollen & Sicherheit

**Login-Methoden**
- **Benutzername + Passwort** (`POST /api/auth/login`) – Benutzername wird auf `{name}@<domain>` gemappt; Passwort mind. 8 Zeichen
- **Passkeys (WebAuthn)** – Fingerabdruck/Face ID. Registrierung nur eingeloggt (`register-options`), Login über discoverable Credentials (`login-options`/`login-verify`). Ein Passkey ist fest an genau einen Benutzer gebunden; die Session beim Passkey-Login entsteht über ein Magic-Link-Token (es wird keine E-Mail versendet)

**Rollen**

| Rolle | Rechte |
| :--- | :--- |
| `admin` | Alles: Objekte, Foto-Import, OCR, Benutzerverwaltung, Planung, Touren, Item-Fotos, Zeitadmin, Chat mit allen Mitarbeitern |
| `facility_manager` | **Reinigungskraft**: sieht NUR zugewiesene Objekte (Name, Adresse, Schlüssel, Kategorie, Items) in Nur-Lese-Ansicht; keine Planung, keine Benutzerverwaltung, kein Anlegen/Bearbeiten/Löschen |
| `driver` | Tourenplanung, Pack-Modus, Tour-Modus, Historie (eigene Touren) |
| `substitute` | **Springer**: sieht wie Fahrer alles (Objekte inkl. Zuletzt-beliefert/Info, Planung, Historie) – keine Objektzuweisung nötig; zusätzlich Vertretungsseite und -kalender |

**Keine öffentliche Registrierung** – Benutzer werden ausschließlich von Admins
über die Benutzerverwaltung angelegt (`/api/auth/users`, nur `admin`). Der
Seed-Admin (Migration `20260801000004_seed_admin.sql`) ist `Admin` /
`bitte-aendern!` (nach dem ersten Login ändern).

**Dreifache Absicherung**
1. **Middleware** (`src/middleware.ts`): schützt alle Routen außer `/login` und den Passkey-Login-APIs. Seiten → Redirect auf `/login?next=…`; API-Routen → `401 UNAUTHENTICATED`
2. **API-Guards**: jede Route prüft `requireUser()` + Rolle (`isAdmin` / `isPlanner` / `isFacilityManager`), zusätzlich Tour-Owner-Checks. **Reinigungskraft:** `/api/objects*` liefert nur zugewiesene Objekte (ohne Letzte-Belieferung-Felder), Item-/Foto-/Pack-Info-Endpunkte sind auf zugewiesene Objekte begrenzt und schreibgeschützt (403)
3. **RLS** in der Datenbank (`auth.uid()` / `current_user_role()`), rund 50 Policies: Passkeys nur für den Besitzer; `objects`/`object_items` rollenbewusst (Reinigungskräfte nur zugewiesene Zeilen, Schreiben nur Admins); `object_assignments` Admin-verwaltet mit Eigen-Lese-Recht; `time_entries`/`time_off_requests` nutzergebunden (eigene Zeilen + Admin; Freigaben nur durch Admins); Audit-Log nur für Admins lesbar

---

## 6. Kernfunktionen & Workflows

### 6.1 Objektverwaltung (`/objects`)
- CRUD für Objekte (Name, Adresse, Kategorie, Öffnungszeit, Schlüsselnummer, Bemerkung, Admin-Infos: Kunde, Kundennummer, Reinigungsturnus) – nur Admins
- **Suche + Sortierung** je Attribut: Name/Adresse (A–Z/Z–A), Schlüssel-Nr. (auf-/absteigend), Kategorie, Items-Anzahl
- **Adress-Autocomplete** per ORS (`/api/geocoding/autocomplete`) + **Verifizierung** beim Speichern (`/api/geocoding/verify`); Stadtteil-Suffixe werden fürs Geocoding normalisiert
- **Fußgängerzone wird beim Speichern automatisch per Overpass erkannt** (keine Checkbox)
- Items je Objekt: Name, Menge, Bemerkung, **Foto-Upload** (`/api/items/photo`, 10 MB); Item-Fotos werden clientseitig auf max. 3072 px komprimiert
- **Info-Dialog** zeigt die letzte Belieferung (Datum, Fahrer, gelieferte Items) und die Admin-Infos
- **Reinigungskräfte (`facility_manager`):** sehen nur zugewiesene Objekte; Tabellenspalten auf Name, Adresse, Schlüssel, Kategorie, Items reduziert (kein „Zuletzt am“/„Info“); der Items-Dialog ist eine reine Lesensicht (keine Bearbeitung, kein Foto-Upload)

### 6.2 Foto-Import (KI, Admin)
Drei Import-Arten über `/api/objects/import/*` (Gemini-OCR):
- **Objekte** (`objects/analyze` + `objects`): abfotografierte Adresslisten → Vorschau mit Duplikat-Erkennung (normalisierte Adresse + Fuzzy-Match), ORS-Geocoding-Status je Eintrag, Fußgängerzonen-Check (OCR-Hinweis **oder** Overpass)
- **Schlüssel** (`keys/analyze` + `keys`): erkannte Schlüsselnummern → Zuordnung zu bestehenden Objekten (Dropdown zeigt vorhandene Schlüsselnummern) oder **„Neues Objekt anlegen…“** (Name/Adresse, wird geocodiert + Fußgängerzone geprüft, Duplikat-Schutz über bestehende Adressen)
- **Items** (`items/analyze` + `items/import`): abfotografierte Packlisten mit Objektname, Kunde, Kundennummer, Reinigungsturnus und Items → Vorschau; **legt ausschließlich neue Objekte mit ihren Items an**, bestehende Objekte werden nie bearbeitet (ähnliche Bestandstreffer werden nur als Warnung zurückgegeben). Die **Übernahme läuft asynchron im Hintergrund** (`maxDuration = 300`): `POST items/import` nimmt den Auftrag sofort mit `202` an und schreibt Objekte + Items über Next.js-`after()`-Hooks; Fehler (z. B. Objekte angelegt, aber Items-Batch fehlgeschlagen) werden per **Push-Benachrichtigung** gemeldet (Tag `photo-import-failure`, `always`), sodass die App währenddessen frei bleibt und ein nächster Import parallel starten kann
- Zusätzliches Einzel-Item-OCR: `/api/items/ocr` wandelt eine abfotografierte Packliste in strukturierte Items für den Items-Dialog um (nur Admin, 10 MB, max. 60 s)

### 6.3 Inventar (`/inventar`, Admin)
- Item-Katalog (Name + Bemerkung) als Vorschlags-Pool für Objekt-Items
- Suche, Anlegen, Inline-Bearbeiten, Löschen

### 6.4 Tourenplanung (`/planung`)
- **Manuelle Auswahl:** Objekte werden pro Tour manuell ausgewählt (Wochentags-Vorauswahl/-Speichern wurde entfernt). Über der Liste zeigt ein Zähler `ausgewählt/gesamt` (z. B. „5/42“) den Fortschritt
- **Unbekannte Ziele:** Ein einzelner Button „+ Unbekanntes Ziel“ legt ein temporäres Ziel an. Im Dialog wird die Adresse per **Autocomplete** gesetzt – speicherbar ist nur ein ausgewählter Vorschlag (gültige Adresse + Koordinaten); ein Maps-Icon neben dem Eingabefeld öffnet die Adresse als Suche in Google Maps. Neue Ziele erscheinen unter „Unbekannte Ziele (x)“ **ganz oben**, sind automatisch ausgewählt und per Checkbox bzw. Zeilen-Tipp ab-/anwählbar; der Stift-Button öffnet den Dialog zum Bearbeiten/Löschen. Sie fließen in die Routenberechnung ein, haben kein Item-Fenster, werden im Tour-Modus direkt als „beliefert“ abhakbar angezeigt und in der Historie mit Name + Adresse (ohne Items/Schlüssel) gelistet. Speicherung nur für die aktuelle Tour: Tab-Wechsel erhält sie (sessionStorage), App-Neustart oder Tour-Start löscht sie; bei Neuberechnung bleiben nur ausgewählte Ziele erhalten
- **Foto-Auswahl** (`/api/planning/photo`): abfotografierte Routenliste → Häkchen automatisch setzen (Match per Adresse/Name, Unmatched werden aufgelistet)
- **Einstempel-Prüfung vor der Planung:** Bei der Routenberechnung prüft die App, ob bereits eingestempelt ist. Ist das nicht der Fall, bietet ein Dialog „Erst einstempeln“ (direkt im Dialog, Auswahl bleibt erhalten) oder „Ohne Einstempeln fortfahren“
- **Startzeit** automatisch (aktuelle Uhrzeit + Vorbereitungszeit, auf 5 Min gerundet) – kein manuelles Auswahlfeld
- **Suche** nach Name/Adresse, gruppiert in Objekte und Treppenhäuser, mit Badges für Fußgängerzone, Öffnungszeit und Bemerkung

### 6.5 Routen-Optimierung (`/api/planning/optimize`)
Eingebettet in `src/lib/routing/optimizer.ts`:

1. **Primär: ORS Optimization API (VROOM)** – Jobs mit Zeitfenstern, Fahrzeug vom Lager
   - **Live-Verkehr:** Ist `TOMTOM_API_KEY` (oder `STADIA_API_KEY`) gesetzt, wird vorab die Fahrzeit-Matrix abgefragt und als Custom Matrix an VROOM übergeben; Ergebnis `traffic_matrix_provider: "tomtom" | "stadia"`
   - Grenzen: VROOM getestet bis 50 Jobs; ORS-Matrix bis 20 Orte; TomTom 100 Orte / 2500 Zellen (Free-Tier), steuerbar über `TOMTOM_MAX_CELLS`
2. **Fallback:** ORS-Matrix → Google-Matrix → Haversine + eigener TSP-Solver (`solveTspWithWindows`)
3. **Zeitfenster:** `opens_at` → frühester Zeitpunkt; Fußgängerzone → **zwei Varianten** werden berechnet: (A) direkt zum Objekt, nur bis 11:00 Uhr (Deadline 11:00); (B) über den per Overpass gesuchten **nächstgelegenen befahrbaren Haltepunkt** (`findNearestDrivablePoint`) + Restweg **zu Fuß** (keine Deadline)
4. **Die schnellere Variante gewinnt:** Die Fußweg-Zeit (≈ 5 km/h) wird beim Vergleich von Variante B berücksichtigt. Bei Variante B zeigt der Stopp „x m zu Fuß“ (`approach_by_foot`); ist A nicht machbar, gewinnt B automatisch (sofern ein Haltepunkt gefunden wurde)
5. **Vorbereitungszeit** am Lager: 4 Min/Stopp + 5 Min Schlüssel (`prep_begin` = Abfahrt − Vorbereitung)
6. **Haltzeit je Ziel** nach Kategorie: Treppenhaus 6 Min, Objekt 7 Min (Objekte werden mit 1 Min weniger Parkzeit berechnet; die Servicezeit fließt in VROOM/TSP und Ankunfts-/Abfahrtszeiten ein)
7. Warnungen (z. B. nicht erfüllbare Restriktionen, Verkehrs-Fallback) als `warnings[]`

Ergebnis (`RouteOptimizationResult`): `mode` (`ors-optimization` | `ors-matrix` | `google-matrix` | `haversine`), sortierte Stopps mit Ankunft/Abfahrt, Koordinaten, Gesamtdauer, Lager. Im **Demo-Modus** (kein ORS-Key) sind die Koordinaten `null` – keine erfundenen Hash-Koordinaten.
- **Koordinaten-Persistierung:** Frisch geocodete Objekt-Adressen (kein Hash-Fallback) werden von der Optimierung **dauerhaft in der DB gespeichert** – Folge-Optimierungen und die Pack-/Tour-Karte nutzen sie ohne erneutes Geocoding
- Stopps ohne Koordinaten bekommen DB-/Geocode-Koordinaten nachgetragen, damit Karte und Liste konsistent bleiben

### 6.6 Pack-Modus (`/planung` nach Optimierung)
- Stopp-Timeline mit Ankunftszeiten, **grünes/rotes Status-Badge** („Route optimiert“ / „Optimierung fehlgeschlagen“)
- **Geschätztes Arbeitsende** wird angezeigt (Lager-Rückkehr + Aufräumzeit: 4 Min/Stopp + 5 Min)
- **Schlüssel-Auswahl:** Ein Button „Schlüssel auswählen“ öffnet einen Dialog mit allen Objekten der Tour und ihren Schlüsselnummern (Checkbox je Objekt, Mehrfachauswahl, Bestätigen schließt). Nach Bestätigung zeigt der Button „Schlüssel: Nr. x, Nr. y, …“ und bleibt zum Nachbessern antippbar. Nur bestätigte Schlüssel werden mit der Tour gespeichert, im Tour-Modus angezeigt und in der Historie unter „Schlüssel mitgenommen“ gelistet
- Klick auf Stopp → **Packliste** (`/api/objects/[id]/pack-info`): Standard-Items + vorgemerkte Extra-Items der letzten Tour; Items mit Foto sind antippbar (Bildansicht); die Item-Liste zeigt oben die Schlüsselnummer („Nr. x“) des Objekts
- **Karte unten** (Leaflet): Rundtour Lager → alle Stopps → Lager inkl. Rückweg, nummerierte Marker, Fußweg-Anteile
- **„Ausfahren beginnen“** → legt die Tour (`/api/tours`, Status `in_transit`) mit der **tatsächlichen aktuellen Uhrzeit** als Start an; geplante Ankunftszeiten und Lager-Rückkehr werden um das Delta verschoben; ausgewählte Schlüssel und Snapshots unbekannter Ziele werden gespeichert; danach wechselt die App in den Tour-Modus
- Der Pack-Entwurf liegt in `sessionStorage` (pro Benutzer), sodass Tab-Wechsel oder Neuladen die Planung nicht verlieren; ein **Banner „Laufende Tour“** bietet Wiedereinstieg und Löschen

### 6.7 Tour-Modus (`/tour/[id]`)
- Stopps in optimierter Reihenfolge mit Fortschrittsbalken, **Karte unten** (belieferte Stopps grün mit Häkchen; nicht lieferbare Stopps markiert)
- Klick auf Stopp → Item-Liste: Standard-Items fest gecheckt/ausgegraut, variable Items für die **nächste Belieferung** an-/abwählbar (wird als `next_delivery_items` gespeichert), optionale Bemerkung je vorgemerktem Item; Objekt-Bemerkung wird angezeigt; Badge „Heute gewünscht“ für Items, die in der letzten Tour vorgemerkt wurden
- Objekt-Stopps zeigen Badge „Nr. x“ mit der im Pack-Modus ausgewählten Schlüsselnummer
- **Unbekannte Ziele** erscheinen ebenfalls (Name + Adresse, kein Item-Dialog) und werden direkt per Check-Button als „beliefert“ markiert
- **„Nicht lieferbar“:** Ein Stopp kann mit optionalem Grund geschlossen werden (Objekt zu, Zutritt verweigert, Schlüssel fehlt). Belieferung und „nicht lieferbar“ schließen sich aus und können rückgängig gemacht werden („Als offen markieren“)
- **„Beliefern fertig“** → Stopp abhaken (speichert einen `delivered_items`-Snapshot: Standard-Items + vorgemerkte/fällige Extras, auch nicht mehr im Katalog geführte Items); sind alle Stopps erledigt (`beliefert + nicht lieferbar = gesamt`), kann die Tour abgeschlossen werden → Status `completed`, `last_delivery_*` wird in den Objekten geschrieben
- **Karten-Vollständigkeit:** Objekte ohne gespeicherte Koordinaten werden beim Tour-Laden (`GET /api/tours/[id]`) einmalig per Photon/ORS geocodet und **in der DB persistiert** (3-s-Timeout, blockiert die Antwort nicht)

### 6.8 Historie (`/historie`)
- Vergangene Touren mit Datum, Fahrer, Anzahl belieferter Stopps und Objekte (`GET /api/tours`)
- **Suche** über Fahrer, Objekt, Adresse, Datum, Schlüsselnummer, Gründe nicht lieferbarer Stopps und unbekannte Ziele
- **Unbekannte Ziele** werden als eigene Sektion mit Name + Adresse angezeigt (ohne Items/Schlüssel); Schlüsselnummern der Tour erscheinen unter „Schlüssel mitgenommen“; nicht lieferbare Stopps mit Grund werden separat gelistet
- Kunden der belieferten Objekte werden nur Admins angezeigt
- Admins dürfen jede Tour löschen; Fahrer/Springer dürfen ihre eigene, noch nicht abgeschlossene Tour löschen (inkl. „Laufende Tour“-Banner); das Löschen kaskadiert auf die Stopps

### 6.9 Vertretung (`/vertretung`, Rolle `substitute`; Admin-Verwaltung im Zeitadmin)
- Springer sehen ihre Einsätze in einem **Kalender** (vorherige/nächste Periode) mit abwesendem Mitarbeiter, Art (Fahrer/Reinigungskraft), Objekt und Zeitraum; Klick auf einen Tag öffnet Details
- **Springer können eigene Vertretungsvorschläge einreichen** (`POST /api/time-tracking/substitutes`): betroffener Mitarbeiter (optional), Zeitraum, Art, Objekt (bei Reinigungskräften) → gespeichert als `time_off_requests` mit `substitute_request = true`, Status `pending`
- Admins bestätigen/bearbeiten/entfernen Vertretungen im Zeitadmin; beim Speichern/Ändern erhält der Springer eine **Push-Benachrichtigung** („Neue Vertretung“ / „Vertretung geändert“, Link `/vertretung`)

### 6.10 Chat (`/chat`)
- Kontaktliste mit Suche und Rollenfilter, Ungelesen-Badge im Header; Admin-Broadcast an mehrere Mitarbeiter mit Bestätigung
- Nachrichten mit Text, Bild- und Audioanhängen, **Eilmeldungen**, Statushaken (`sent`/`delivered`/`read`), Uhrzeit und Übersetzung
- **Audio-Transkription** (`/api/chat/transcribe`, Gemini), damit Sprachnachrichten lesbar sind; das Transkript wird an der Nachricht gespeichert
- **Übersetzung** (`/api/chat/translate`): je Nachricht in eine Zielsprache, gecacht in `chat_translations`; die persönliche Wunschsprache liegt in `profiles.chat_preferred_language` (`/api/chat/preferences`)
- **Anruf-Button:** Admins können die hinterlegte Telefonnummer des Mitarbeiters anrufen, Mitarbeiter die zentrale Supportnummer aus `company_settings`
- **Push-Benachrichtigungen** (`/api/chat/push`, VAPID): Die Subscription wird app-weit nach dem Login eingerichtet (einmalig), ungültige Endpunkte werden beim Versand entfernt; das Payload unterstützt `tag` und `always` (auch anzeigen, wenn ein Tab sichtbar ist)
- Die Thread-Ansicht ist auf mobilen Geräten als Master-Detail-Navigation umgesetzt (Liste oder Verlauf, mit Zurück-Navigation); eigene Nachrichten rechts als blaue Bubbles (max. 75 % Breite), empfangene Nachrichten links
- **Offline-First:** Nachrichten werden lokal in IndexedDB zwischengespeichert und aus der Upload-Warteschlange synchronisiert; der Thread-Index und Batch-Schreibvorgänge reduzieren die Ladezeit

### 6.11 Einstellungen (`/einstellungen`)
- **Profil:** Benutzername (Login-Kennung), Anzeigename, Telefonnummer
- **Passwort ändern** (`/api/auth/me-password`, mind. 8 Zeichen)
- **Passkeys:** eigene Passkeys registrieren/löschen (Liste mit Anlage/letzter Nutzung)
- **Firmenkontakt (Admin):** zentrale Supportnummer für den Anruf-Button im Chat (`/api/chat/config` PATCH)
- **Benutzerverwaltung (Admin):** Konten anlegen (Benutzername, Passwort, Rolle, **Vertragsart**, Sollstunden/Arbeitstage/Urlaubstage, Objektzuweisung bei Reinigungskräften – mind. 1), Rolle ändern, **Vertragsart ändern**, Vertragswerte bearbeiten (Sollstunden 1–168, Arbeitstage 1–7, Urlaubstage 0–365), Objekte neu zuweisen
- **Vertrags-Auto-Fill:** Vollzeit 40/5/30, Teilzeit 20/5/30, Minijob 10/2/12; `custom` („Individuell“) blendet Sollstunden und Arbeitstage als Eingabefelder ein; der Urlaubsanspruch wird als `round(30 × Arbeitstage ÷ 5)` vorgeschlagen und bleibt immer manuell anpassbar

### 6.12 Zeiterfassung & Abwesenheitsverwaltung
**Stempeluhr (auf allen Seiten sichtbar):** `ClockWidget` im Header (Desktop) bzw. in der unteren Leiste (Handy). Ein-/Ausstempeln, Pausen-Toggle + feste Pausen-Presets (+15/30/45/60 Min.), Live-Zähler, Browser-Erinnerung „Vergessen auszustempeln?“ (nach 8 h oder ab 17:00 Uhr mit ≥ 1 h, einmalig je Stempelung). **Offline-First** über IndexedDB + LWW (`client_updated_at`, Serverzeit-Ausrichtung via `/api/time`).

**Mitarbeiter-Dashboard (`/zeiterfassung`):**
- Wochen-/Monatssummen und **Überstundenkonto** (automatischer Soll/Ist-Vergleich auf Basis von `weekly_target_hours`; nur freigegebene, abgeschlossene Einträge und abgeschlossene Wochen zählen; **nur Plusstunden** werden aufgebaut – keine Minusstunden, laufende Wochen zählen noch nicht) + manuelle Admin-Korrektur
- **Resturlaub** = `vacation_days_per_year − vacation_days_used`
- **Arbeitszeit nachreichen** (vergessene Stempelung) → Eintrag mit `source = submitted`, `is_approved = false` → wartet im Freigabe-Feed
- **Abwesenheitsanträge** (Urlaub, Krankheit, unbezahlt, Freizeitausgleich) mit Status-Anzeige und optionaler Springer-Auswahl

**Auto-Timeout & Prüfbedarf (vergessene Ausstempelung):**
- Eine offene Stempelung, die **12 h** überschreitet oder **Mitternacht (Europa/Berlin)** erreicht, wird `requires_review = true` + `is_approved = false` (DB-Trigger bei Schreibvorgängen, Housekeeping `flag_overdue_time_entries` bei jedem Zugriff)
- Solche Einträge fließen **nicht** in Wochen-/Monatssummen oder das Überstundenkonto, bis sie freigegeben sind
- **Zwangspopup beim App-Start:** Für ungelöste, noch offene Prüfbedarf-Einträge erscheint ein **nicht schließbares** Dialogfenster mit tatsächlicher Endzeit, Pause und Notiz (`PATCH /api/time-tracking/entries/[id]`). Absenden schließt den Eintrag (`source = submitted`) → „Nachgereicht / Warten auf Freigabe“; das Popup verschwindet, sobald der Eintrag geschlossen oder freigegeben ist; erneute Prüfung bei Tab-Fokus

**Pausen-Automatik (§ 4 ArbZG):** Anwesenheitszeit **> 6 bis 9 Std. → mindestens 30 Min. Pause, > 9 Std. → mindestens 45 Min.** Die erfasste Pause wird automatisch auf das Minimum ergänzt (nie reduziert) – der DB-Trigger deckt alle Schreibpfade ab (Stempeluhr, Offline-Sync, Nachreichung, Admin-Korrektur). Netto-Arbeitszeit = `(clock_out − clock_in) − Pause`.

**Zeitadmin (`/admin/zeiterfassung`):**
- **Mitarbeiterstatus:** Listen- oder Kalenderansicht; wer gerade eingestempelt ist, aktuelle Tour/nächstes Objekt, Überstunden, Vertrag; Suchfilter; Abwesenheitskalender mit Mitarbeiter-Suchfilter und „Abwesenheit hinzufügen“
- **Monatsübersicht:** Gesamtarbeitszeit aller Mitarbeiter im gewählten Monat (freigegebene, abgeschlossene Einträge); Minijob-Limit-Färbung (orange ≥ 85 %, rot ≥ 100 %), Klick auf eine Zeile filtert
- **Prüfbedarf:** alle markierten offenen Stempelungen mit live zählender Dauer; „Ausstempeln & Freigeben“ (Endzeit, Pause, Notiz, optionaler Grund – schließt, erzwingt die Mindestpause, setzt `is_approved = true`) und „Löschen“
- **Freigabe-Feed:** geschlossene, noch nicht freigegebene Einträge („Nachgereichte Arbeitszeit“ / „Vergessene Ausstempelung“) und offene Anträge, mit Icon + Status-Badge
- **Änderungsprotokoll (Audit Log):** Jede Admin-Anpassung/-Freigabe/-Löschung wird revisionssicher protokolliert (alt→neu-Snapshot, Bearbeiter, Zeitstempel, Grund – „Offline-Änderung (Sync)“ bei Offline-Änderungen); auch Nachreichungen der Mitarbeiter werden protokolliert. Bearbeitete Einträge zeigen ein Historiensymbol mit Tooltip („{Begründung} von X am DD.MM.YYYY um HH:MM“); Klick öffnet einen Dialog mit allen Änderungen inkl. Feld-Diff
- Einträge anlegen/bearbeiten (mit Pflichtgrund fürs Audit-Log), löschen, Urlaubs-/Überstunden-Korrekturen; **Lohn-CSV-Export** (`/api/admin/time-tracking/export`, UTC-Zeiten in `Europe/Berlin` dargestellt, wochentagsbewusst)

### 6.13 Ladezeit-Messung
`src/lib/perf.ts` instrumentiert alle Item-Listen (Tour, Liefer-Dialog, Pack-Dialog, Items-Dialog, Inventar, Historie, Planung) mit Stale-while-revalidate-Kennung (Cache-Stand vs. Netz), Zeilenanzahl und Netzwerktyp. Logging nur in der Dev-Konsole bei Werten > 1 s; keine UI, kein Verhaltens-Einfluss.

---

## 7. Offline-First & Synchronisation

- Synchronisierbare Tabellen: `profiles`, `objects`, `object_items`, `inventory_items`, `active_tours`, `tour_stops`, `time_entries`, `time_off_requests`
- Offline-Schreibvorgänge werden in IndexedDB als `pending_upload` gespeichert und beim Reconnect über `POST /api/sync` synchronisiert. Last-Write-Wins nutzt `client_updated_at`; bei Konflikten übernimmt der Client den Server-Datensatz. Die Serverzeit wird über `GET /api/time` angeglichen.
- Die Sync-Engine verarbeitet Tabellen in Abhängigkeitsreihenfolge (Touren vor Tourstopps), in Batches, und schützt lokale Änderungen, die während eines laufenden Syncs entstanden sind.
- Löschen, Foto-/OCR-Import, Authentifizierung, Passwort-/Passkey-Verwaltung und Benutzeranlage bleiben online-only. Lesbare Daten werden je nach Endpunkt aus IndexedDB bereitgestellt; der Service Worker cached die App-Shell, greift aber nicht in `/api/*` ein.
- Schlüssel-Auswahl und unbekannte Ziele sind offline voll funktionsfähig: Die Sync-Whitelist für `tour_stops` enthält `key_number`, `is_unknown` und die Unbekannt-Ziel-Spalten; die Offline-Historie/Tour-Ansicht rekonstruiert sie aus dem Cache. Das Adress-Autocomplete für neue Vorschläge braucht eine Verbindung.
- **Hover-Prefetch:** Beim Überfahren/Fokussieren eines Navigationslinks wird der Daten-Endpunkt der Seite in den IndexedDB-Cache vorgeladen (debounced + dedupliziert), damit die Seite nach dem Klick sofort aus dem Cache rendert.
- Performance: Cache-Schreibvorgänge laufen als je eine Lese- + Schreib-Transaktion pro Tabelle (statt zwei pro Zeile); die Offline-Queue liest Pending-Einträge über einen `sync_status`-Index; der Historie-/Tour-Assembler gruppiert Stopps einmal pro `tour_id`.
- Der Sync-/Offline-Indikator im Header zeigt Online-/Offline-Status, laufende Synchronisierung, offene Einträge, letzten Sync und Fehler.

## 8. Karten (Leaflet)

- `src/components/map/route-map.tsx` – imperatives Leaflet (nur im `useEffect`, SSR-sicher), OSM-Kacheln (kostenlos)
- Straßenverlauf per **ORS-Directions** (`POST /api/planning/route-geometry`, Bearer-Auth, Polyline-Decoder in `src/lib/polyline.ts`); Fallback: gestrichelte Luftlinien
- Eingesetzt im Pack-Modus und in der Tour-Ansicht; Autofit auf alle Punkte; nur Stopps mit Koordinaten werden angezeigt
- `NavigateButton` öffnet die Stopp-Adresse bzw. Koordinaten in der Karten-App des Geräts

## 9. API-Übersicht (alle geschützt, Rolle in Klammern)

**Auth:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me-profile` · `POST /api/auth/me-password`
**Passkeys:** `POST /api/auth/passkeys/login-options` (öffentlich) · `login-verify` (öffentlich) · `register-options` · `register-verify` · `DELETE /api/auth/passkeys/[id]`
**Benutzer (Admin):** `GET/POST /api/auth/users` · `PATCH/DELETE /api/auth/users/[id]`
**Geocoding:** `POST /api/geocoding/autocomplete` · `POST /api/geocoding/verify`
**Objekte (Admin; Reinigungskraft lesend):** `GET/POST /api/objects` · `GET/PATCH/DELETE /api/objects/[id]` · `GET/POST /api/objects/[id]/items` · `PATCH/DELETE /api/objects/[id]/items/[itemId]` · `GET /api/objects/[id]/pack-info`
**Inventar (Admin):** `GET/POST /api/inventory` · `PUT/DELETE /api/inventory/[id]`
**Import (Admin):** `POST /api/objects/import/objects[/analyze]` · `…/keys[/analyze]` · `…/items[/analyze]` · `POST /api/objects/import/items/import` (asynchron, `202`, Ergebnis/Fehler per Push) · `POST /api/items/ocr` · `POST /api/items/photo`
**Planung (Driver/Admin/Springer):** `GET /api/planning` · `POST /api/planning/optimize` · `POST /api/planning/photo` · `POST /api/planning/route-geometry`
**Touren (Driver/Admin/Springer):** `GET/POST /api/tours` · `GET/PATCH/DELETE /api/tours/[id]` · `PATCH /api/tours/[id]/stops/[stopId]`
**Zeiterfassung (angemeldet):** `GET/POST /api/time-tracking/clock` · `GET/POST /api/time-tracking/entries` · `PATCH /api/time-tracking/entries/[id]` · `GET /api/time-tracking/review` · `GET /api/time-tracking/summary` · `GET/POST /api/time-tracking/requests` · `PATCH /api/time-tracking/requests/[id]` · `GET/POST /api/time-tracking/substitutes`
**Zeitadmin (Admin):** `GET /api/admin/time-tracking/overview` (inkl. `audit_logs` je Eintrag) · `GET /api/admin/time-tracking/status` · `GET /api/admin/time-tracking/export` (Lohn-CSV) · `POST /api/admin/time-tracking/entries` · `PATCH/DELETE /api/admin/time-tracking/entries/[id]`
**Chat:** `GET/PATCH /api/chat/config` · `GET /api/chat/contacts` · `GET/POST /api/chat/messages` · `PATCH /api/chat/preferences` · `POST /api/chat/push` · `GET /api/chat/summary` · `GET/POST /api/chat/threads` · `POST /api/chat/transcribe` · `POST /api/chat/translate`
**System:** `POST /api/sync` (LWW-Sync) · `GET /api/time` (Serverzeit)

## 10. Deployment & Datenbank

- `npm ci` → `npm run dev` (http://localhost:3000) · `npm run build` · `npm run typecheck`
- Datenbank: 42 Migrationen in `supabase/migrations/` in Dateinamen-Reihenfolge (`supabase db push`) oder `supabase/setup.sql` einmalig im Supabase SQL-Editor (enthält alle Migrationen in Reihenfolge, inkl. Seed-Admin)
- Seed-Admin: Benutzername `Admin`, Passwort `bitte-aendern!` – nach dem ersten Login ändern
- **Freebuff Sites / Cloudflare Workers:** Der Ordner ist für den OpenNext-Adapter vorbereitet (`freebuff.open-next.config.ts`, `freebuff.wrangler.jsonc`). `NEXT_PUBLIC_*`-Werte müssen vor dem Build gesetzt sein (sie werden eingetragen); nicht-öffentliche Werte (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ORS_API_KEY`, `VAPID_*`) liest der Worker zur Laufzeit aus der Umgebung und können als Sites-Secret hinterlegt werden
- Migrationen müssen vor dem ersten Request eingespielt sein; Versionsnummern müssen eindeutig sein

## 11. Projektstruktur (Auszug)

```
RAW_DE/
  src/middleware.ts                  # Session-Refresh + Seiten-/API-Schutz
  src/app/page.tsx                   # Redirect: Fahrer/Springer → /planung, sonst → /objects
    login/ · objects/ · inventar/ · planung/ · tour/[id]/ · historie/ · chat/
    einstellungen/ · zeiterfassung/ · vertretung/ · admin/zeiterfassung/
  src/app/api/                       # 58 Route Handler (Auth, Users, Passkeys, Geocoding, Items,
                                     # Objects inkl. import/*, Inventory, Planning, Tours, Chat,
                                     # Time-Tracking inkl. admin/*, Sync, Time)
  src/components/
    app-shell.tsx                    # Header-Navigation (rollenabhängig), Stempeluhr, Sync-Badge, Push-Setup
    map/route-map.tsx                # Leaflet-Route
    objects/                         # Objektverwaltung + Foto-Import-Dialoge
    inventory/                       # Inventar (Item-Katalog, Admin)
    planning/                        # Planung, Pack-Modus, Foto-Auswahl, Schlüssel-Dialog, unbekannte Ziele
    tour/                            # Tour-Modus, Liefer-Dialog, Navigations-Button
    chat/                            # Kontaktliste, Thread-Verlauf, Medien, Push, Offline-Queue
    time-tracking/                   # Stempeluhr, Zeiterfassung, Zeitadmin, Prüfbedarf-Popup, Abwesenheitskalender
    substitute/                      # Vertretungsseite + Kalender
    settings/ · history/ · auth/ · ui/
  src/lib/
    company.ts · warehouse.ts · region.ts   # Firmen-/Lager-/Einsatzgebiets-Konfiguration
    auth.ts · webauthn.ts                   # Auth, Rollen, Passkey-Verifikation
    ors.ts · photon.ts · address.ts · overpass.ts   # Geocoding, Adress-Normalisierung, Fußgängerzonen
    ocr.ts · gemini-chat.ts                  # Foto-Import, Transkription, Übersetzung
    traffic-matrix.ts · stadia-matrix.ts     # Live-Verkehrs-Matrizen
    routing/optimizer.ts · routing/tsp.ts · routing/time.ts   # VROOM + Matrix + TSP + Zeitfenster
    contract.ts · time-format.ts · time-tracking.ts           # Soll/Ist, Überstunden, ArbZG-Pausen, Audit
    offline/                        # db, fetch, sync, clock, chat
    lww.ts · sync-tables.ts         # Last-Write-Wins-Registry und synchronisierbare Tabellen
    perf.ts · realtime.ts · storage.ts · image-upload.ts
  supabase/migrations/              # 42 versionierte Schema-/Performance-Migrationen
  supabase/setup.sql                # alle Migrationen in einer Datei für den SQL-Editor
```

## 12. Bekannter Stand & Einschränkungen

- **UI-Sprache:** durchgängig Deutsch; Code-Kommentare und einzelne interne Log-Texte sind teilweise noch gemischt. Das ist kosmetisch und ohne Verhaltens-Einfluss.
- **Rechtliche Defaults sind deutsch:** Pausen-Automatik und Urlaubsverbuchung folgen ArbZG/BUrlG (30/45 Min. Pausen, 30 Tage bei 5 Tagen/Woche). Andere Rechtsräume brauchen andere Regeln in den DB-Triggern.
- **Feste Zeitzone:** Zeitauswertung und Lohnexport verwenden `Europe/Berlin` (auch im CSV-Export).
- **Vorlagen-Charakter:** eine Firma pro Deployment – es gibt keine Mandantentrennung; Branding, Lager und Einsatzgebiet kommen aus Umgebungsvariablen.
- **Demo-Modus:** Ohne `ORS_API_KEY` fällt die Optimierung auf Haversine mit `null`-Koordinaten zurück (keine erfundenen Positionen auf der Karte).
- **Chat** benötigt `VAPID_*` für Push und `GEMINI_API_KEY` für Transkription/Übersetzung; ohne Keys degradieren diese Funktionen sauber.
