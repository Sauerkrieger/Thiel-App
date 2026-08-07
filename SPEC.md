# Thiel Dienstleistungen – System-Spezifikation

Liefer- & Tourenplanungs-App für Thiel Dienstleistungen (mobile-optimierte Web-App).
Stand: August 2026 – beschreibt den **aktuellen Ist-Zustand** des Codes.

---

## 1. Überblick

Die App unterstützt den kompletten Arbeitsablauf einer Reinigungs-/Liefer-Rundtour:

1. **Objekte verwalten** (Ziele, Treppenhäuser) inkl. Items, Schlüsselnummern und Fotos
2. **Touren planen** – Wochentags-Defaults, Foto-Auswahl, optimierte Rundtour vom/zum Lager
3. **Packen** – konsolidierte Packlisten je Objekt, Route auf der Karte
4. **Ausliefern** – Stopps in optimierter Reihenfolge, Items vorab gecheckt, Belieferung abhaken
5. **Historie & Einstellungen** – vergangene Touren, Profil, Passwort, Passkeys

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
`contract_type` (`full_time` | `part_time` | `mini_job`), `object_category` (`objekt` | `treppenhaus`), `tour_status` (`packing` | `in_transit` | `completed`).

### `profiles` – Benutzerprofile (1:1 zu `auth.users`)
- `id` (PK → auth.users, cascade), `name`, `role` (user_role, default `driver`), `email`, `created_at`, `updated_at`
- `contract_type` (`full_time` | `part_time` | `mini_job`, default `full_time`) – Vertragsart, steuert das Soll im Überstundenkonto (40/20/10 h pro Woche, bewusst nicht angezeigt)
- Trigger `on_auth_user_created` legt das Profil bei Auth-Registrierung automatisch an
- **Login-Kennung:** Benutzername wird auf `{name}@thiel.local` gemappt

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

### `weekly_default_routes` – Wochentags-Vorauswahl (pro Benutzer)
- `id`, `user_id` (FK auth.users, **jeder Nutzer hat eigene Defaults**), `day_of_week` (0–6, 0 = Sonntag), `object_id`, `selection_order`
- Unique `(user_id, day_of_week, object_id)`; Ersetzung transaktional über RPC `save_weekly_defaults(user_id, day_of_week, object_ids)`

### `active_tours` + `tour_stops` – Touren
- `active_tours`: `id`, `driver_id`, `date`, `status` (packing → in_transit → completed), `start_time`, `total_duration_minutes`
- `tour_stops`: `id`, `tour_id` (FK cascade), `object_id`, `stop_order` (unique je Tour), `arrival_time`, `is_delivered`, `next_delivery_items` (jsonb – vorgemerkte Extra-Items für die **nächste** Belieferung)

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
3. **RLS** in der Datenbank (`auth.uid()` / `current_user_role()`) – Passkeys nur für den Besitzer; `objects`/`object_items` rollenbewusst (Reinigungskräfte nur zugewiesene Zeilen, Schreiben nur Admins); `object_assignments` Admin-verwaltet mit Eigen-Lese-Recht

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
- **Items** (`items/analyze` + `items`): Packlisten pro Objekt → Zuordnung zu Objekten (per Adresse/Name) oder Verwerfen; Menge + Bemerkung strukturiert, **je Item per Checkbox als Standard-Item markierbar** (`is_always_required`)

### 5.3 Tourenplanung (`/planung`)
- **Wochentags-Defaults:** Vorauswahl des gleichen Wochentags (pro Benutzer) wird geladen; Änderungen werden per `save_weekly_defaults` gespeichert
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
5. **Vorbereitungszeit** am Lager: 3 Min/Stopp + 5 Min Schlüssel (`prep_begin` = Abfahrt − Vorbereitung)
6. **Haltzeit je Ziel** nach Kategorie: Treppenhaus 3 Min, Objekt 5 Min (Servicezeit fließt in VROOM/TSP-Solver und Ankunfts-/Abfahrtszeiten ein)
7. Warnungen (z. B. nicht erfüllbare Restriktionen) als `warnings[]`

Ergebnis (`RouteOptimizationResult`): `mode` (`ors-optimization` | `ors-matrix` | `google-matrix` | `haversine`), sortierte Stopps mit Ankunft/Abfahrt, Koordinaten, Gesamtdauer, Lager (`warehouse`). Im **Demo-Modus** (kein ORS-Key) `null`-Koordinaten – keine erfundenen Hash-Koordinaten.

### 5.5 Pack-Modus (`/planung` nach Optimierung)
- Stopp-Timeline mit Ankunftszeiten, **grünes/rotes Status-Badge** („Optimierung erfolgreich" / „Optimierung fehlgeschlagen")
- **Geschätztes Arbeitsende** wird angezeigt (Lager-Rückkehr + Aufräumzeit: 3 Min/Stopp + 5 Min) – bewusst ohne Rechnungsweg
- Klick auf Stopp → **Packliste** (`/api/objects/[id]/pack-info`): Standard-Items + vorgemerkte Extra-Items der letzten Tour; Items mit Foto sind antippbar (Bildansicht)
- **Karte unten** (Leaflet): Rundtour Lager → alle Stopps → Lager inkl. Rückweg, nummerierte Marker, Fußweg-Anteile
- **„Ausfahren beginnen"** → Tour anlegen (`/api/tours`) und in den Tour-Modus wechseln

### 5.6 Tour-Modus (`/tour/[id]`)
- Stopps in optimierter Reihenfolge mit Fortschrittsbalken, **Karte unten** (belieferte Stopps grün mit Häkchen)
- Klick auf Stopp → Item-Liste: Standard-Items fest gecheckt/ausgegraut, variable Items für die **nächste Belieferung** an-/abwählbar (wird als `next_delivery_items` gespeichert)
- **„Beliefern fertig"** → Stopp abhaken; alle Stopps fertig → Tour `completed`

### 5.7 Historie (`/historie`)
- Vergangene Touren mit Datum, Fahrer, Anzahl belieferter Stopps und belieferten Objekten (`GET /api/tours`)

### 5.8 Einstellungen (`/einstellungen`)
- Profil (Name), Passwort ändern (`/api/auth/me-password`), **Passkeys verwalten** (registrieren/löschen, eigene nur)
- **Benutzerverwaltung (Admin):** Konten anlegen, Rollen vergeben, **Vertragsart** (Vollzeit/Teilzeit/Minijob – bestimmt das Soll im Überstundenkonto) und **Objekte zuweisen** – beim Anlegen einer Reinigungskraft erscheint die Objektauswahl (Pflicht, mind. 1); bestehende Reinigungskräfte haben einen „Objekte"-Button zum Nachbearbeiten der Zuweisung

## 6. Karten (Leaflet)
- `src/components/map/route-map.tsx` – imperatives Leaflet (nur im `useEffect`, SSR-sicher), OSM-Kacheln (kostenlos)
- Straßenverlauf per **ORS-Directions** (`POST /api/planning/route-geometry`, Bearer-Auth, Polyline-Decoder in `src/lib/polyline.ts`); Fallback: gestrichelte Luftlinien
- Eingesetzt im Pack-Modus und in der Tour-Ansicht; Autofit auf alle Punkte

## 7. API-Übersicht (alle geschützt, Rolle in Klammern)

**Auth:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me-profile` · `POST /api/auth/me-password`
**Passkeys:** `POST /api/auth/passkeys/login-options` (öffentlich) · `login-verify` (öffentlich) · `register-options` · `register-verify` · `DELETE /api/auth/passkeys/[id]`
**Benutzer (Admin):** `GET/POST /api/auth/users` · `PATCH/DELETE /api/auth/users/[id]`
**Geocoding:** `POST /api/geocoding/autocomplete` · `POST /api/geocoding/verify`
**Objekte (Admin; Facility lesend):** `GET/POST /api/objects` · `GET/PATCH/DELETE /api/objects/[id]` · `GET/POST /api/objects/[id]/items` · `PATCH/DELETE /api/objects/[id]/items/[itemId]` · `GET /api/objects/[id]/pack-info`
**Inventar (Admin):** `GET/POST /api/inventory` · `PUT/DELETE /api/inventory/[id]`
**Import (Admin):** `POST /api/objects/import/objects[/analyze]` · `…/keys[/analyze]` · `…/items[/analyze]`
**Items:** `POST /api/items/ocr` · `POST /api/items/photo` (alle außer Reinigungskräfte)

**Objektzuweisungen (Admin):** verwaltet über `PATCH /api/auth/users/[id]` bzw. `POST /api/auth/users` (`object_ids`, mind. 1 bei Reinigungskräften); Vertragsart über `contract_type` (GET/POST/PATCH)
**Planung (Driver/Admin):** `GET/POST /api/planning` · `POST /api/planning/optimize` · `POST /api/planning/photo` · `POST /api/planning/route-geometry`
**Touren (Driver/Admin):** `GET/POST /api/tours` · `GET/PATCH/DELETE /api/tours/[id]` · `PATCH /api/tours/[id]/stops/[stopId]`

## 8. Umgebungsvariablen (`.env.local`)

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

## 9. Projektstruktur (Auszug)

```
src/
  middleware.ts                     # Session-Refresh + Seiten-/API-Schutz
  app/
    page.tsx                        # Redirect → /objects
    login/ · objects/ · inventar/ · planung/ · tour/[id]/ · historie/ · einstellungen/
    api/                            # auth, users, passkeys, geocoding, items,
                                    # objects (inkl. import/*), inventory, planning, tours
  components/
    app-shell.tsx                   # Header-Navigation (rollenabhängig)
    map/route-map.tsx               # Leaflet-Route
    objects/                        # Objektverwaltung + Foto-Import-Dialoge
    inventory/                      # Inventar (Item-Katalog, Admin)
    planning/                       # Planung, Pack-Modus, Foto-Auswahl
    tour/                           # Tour-Modus, Liefer-Dialog
    settings/ · history/ · auth/ · ui/
  lib/
    auth.ts                         # requireUser, Rollen, Username↔Email
    ors.ts · overpass.ts · ocr.ts · traffic-matrix.ts · warehouse.ts · polyline.ts
    routing/optimizer.ts            # VROOM + Matrix + TSP + Zeitfenster
    routing/tsp.ts · time.ts
    supabase/                       # server/admin/middleware-Client
    webauthn.ts                     # Passkey-Verifikation
supabase/migrations/                # 22 Migrationen (Schema von Grund auf)
```

## 10. Entwicklung

- `npm run dev` – Dev-Server · `npm run build` – Produktions-Build · `npm run typecheck` – `tsc --noEmit` · `npm start` – Produktions-Server
- Migrationen werden in `supabase/migrations/` versioniert (laufen auf dem Supabase-Projekt)
- Deployment über Git-Push nach `main` (Vercel/GitHub Actions), Migrationen vor dem ersten Request einspielen
