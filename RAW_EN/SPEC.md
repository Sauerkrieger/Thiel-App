# Company App (RAW_EN) – System Specification

Delivery & tour planning app (mobile-first web app), English-language and
company-independent template. This document describes the **current state of the
code** in `RAW_EN/` (as of November 2026).

---

## 1. Overview

The app supports the complete workday of a delivery/service round trip:

1. **Manage objects** (customer sites, stairwells) including items, key numbers, notes and photos
2. **Plan tours** – manual selection, photo selection, optimised round trip from/to the warehouse
3. **Pack** – consolidated packing lists per object, route on the map
4. **Deliver** – stops in optimised order, items pre-checked, mark delivery as done (or as not deliverable)
5. **History & settings** – past tours, profile, password, passkeys
6. **Time tracking & absence management** – time clock, submitted work time, absence requests, substitution, time admin with review queue (automatic timeout for forgotten clock-outs)
7. **Chat** – employee/admin communication with media, urgent messages, transcription, translation, push and offline support

The workflow is modelled as a **round trip**: start and end are always the
warehouse (`NEXT_PUBLIC_WAREHOUSE_NAME` / `WAREHOUSE_ADDRESS`). Unlike the
German variant, `RAW_EN` contains **no company name, no fixed warehouse and no
fixed service area** – all of these come from environment variables, so the same
code can be reused for another company without code changes.

---

## 2. Tech stack & architecture

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, shadcn/ui (Radix), lucide-react, sonner | Mobile-first UI, server components + client components |
| **Backend / DB** | Supabase (PostgreSQL + Auth + Storage), `@supabase/ssr` | Data model, sessions, RLS, storage bucket for item photos |
| **Auth** | Supabase Auth (password) + WebAuthn passkeys (`@simplewebauthn`) | Login with username/password **and** fingerprint/Face ID |
| **Route optimisation** | ORS Optimization API (VROOM) with custom matrix | Optimal round trip under time windows and restrictions |
| **Live traffic** | TomTom Routing Matrix API, alternatively Stadia Maps matrix | Current travel times (incl. traffic) as VROOM custom matrix |
| **Geocoding** | OpenRouteService Geocode Search, Photon as fallback | Address autocomplete and coordinate verification |
| **Pedestrian zones** | Overpass API (OpenStreetMap) | Automatic detection + nearest drivable stop |
| **Maps** | Leaflet (imperative, without react-leaflet), OSM tiles, ORS Directions | Route geometry in pack and tour mode |
| **OCR / vision** | Gemini vision API | Recognising photographed lists (objects, keys, items) and audio transcription |
| **Route fallback** | ORS matrix → Google matrix → Haversine + own TSP solver | Optimisation also works without the primary API |
| **Deployment** | OpenNext adapter + Wrangler (`freebuff.wrangler.jsonc`, `freebuff.open-next.config.ts`) | Cloudflare Workers / Freebuff Sites |

---

## 3. Configuration

All company and region values come from environment variables (see
`.env.local.example`). `NEXT_PUBLIC_*` values are compiled in at **build time**
and are also visible in the browser; changing them requires a new build.

| Variable | Required | Effect |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_COMPANY_NAME` | – | Name in header, login, page title, passkey name (default `Example Company`) |
| `NEXT_PUBLIC_COMPANY_SLUG` | – | Short form for file names (payroll export); default derived from the name |
| `NEXT_PUBLIC_USER_EMAIL_DOMAIN` | – | Internal login domain: username `max` becomes `max@<domain>` (default `company.local`) |
| `NEXT_PUBLIC_WAREHOUSE_NAME` | – | Warehouse name (default: company name) |
| `WAREHOUSE_ADDRESS` / `NEXT_PUBLIC_WAREHOUSE_ADDRESS` | – | Warehouse address (start/end of the round trip); default `1 Example Street, 12345 Example Town` |
| `NEXT_PUBLIC_SERVICE_CITY` | – | City added to addresses without one; empty = no city added |
| `NEXT_PUBLIC_SERVICE_CITY_LAT` / `_LON` | – | Location bias for the geocoding search |
| `NEXT_PUBLIC_SERVICE_AREA_BOUNDARY` | – | Search boundary `minLon,minLat,maxLon,maxLat` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase client & middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-side only (API routes), never in the frontend |
| `ORS_API_KEY` | recommended | Geocoding, directions, VROOM optimisation (premium key = JWT → `Bearer`, otherwise `apikey`) |
| `TOMTOM_API_KEY` | – | Live traffic matrix (custom matrix for VROOM) |
| `TOMTOM_MAX_CELLS` | – | Limit of matrix cells (default 2500) |
| `STADIA_API_KEY` | – | Alternative live-traffic matrix provider |
| `GOOGLE_MAPS_API_KEY` | – | Optional matrix fallback |
| `GEMINI_API_KEY` | – | OCR (photo import) and chat transcription |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` | – | Passkey relying party (default: host / company name) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | – | Web push for chat and substitution notifications |

**Service-area rule:** if a service area is configured, addresses without a city
are treated as belonging to that area (city appended, search restricted). Without
configuration the app works location-independent.

**Pedestrian-zone fallback:** `PEDESTRIAN_FALLBACK_POLYGONS` in `src/lib/region.ts`
can hold local polygons used when Overpass is unreachable (empty by default).

---

## 4. Data model (Supabase / PostgreSQL)

**Enums:** `user_role` (`driver` | `admin` | `facility_manager` | `substitute`),
`contract_type` (`full_time` | `part_time` | `mini_job` | `custom`),
`object_category` (`objekt` | `treppenhaus`),
`tour_status` (`packing` | `in_transit` | `completed`),
`time_entry_source` (`clock` | `submitted`),
`time_off_type` (`vacation` | `sick_leave` | `unpaid` | `compensatory`),
`time_off_status` (`pending` | `approved` | `rejected`),
`chat_message_kind` (`text` | `image` | `audio`),
`chat_message_status` (`sent` | `delivered` | `read`).

### `profiles` – user profiles (1:1 with `auth.users`)
- `id` (PK → `auth.users`, cascade), `name`, `role` (default `driver`), `email`, `phone`, `created_at`, `updated_at`
- `contract_type` – controls the target hours in the overtime account
- `weekly_target_hours` (default 40) – weekly target hours (auto-filled: full time 40 / part time 20 / mini job 10)
- `working_days_per_week` (default 5) – planned working days (5/5/2; basis for vacation entitlement)
- `vacation_days_per_year` (default 30) – individual annual vacation days; remaining = `per_year − used`
- `vacation_days_total`, `vacation_days_used`, `overtime_hours` (manual correction)
- `chat_preferred_language` – personal translation language
- LWW fields `client_updated_at`, `synced_at`
- Trigger `on_auth_user_created` creates the profile on auth signup (incl. contract defaults)
- **Login identifier:** username mapped to `{name}@<NEXT_PUBLIC_USER_EMAIL_DOMAIN>`

### `time_entries` – clock-ins
- `id`, `user_id` (FK `auth.users`, cascade), `clock_in`, `clock_out` (nullable), `break_duration_minutes` (default 0), `note`
- `is_approved` (default true) – approval state; `requires_review` (default false) – needs review (forgotten clock-out)
- `source` (`clock` = time clock, `submitted` = submitted work time)
- **At most ONE open entry per user** (partial unique index `WHERE clock_out IS NULL`)
- LWW fields + `updated_at` trigger
- **Auto-timeout trigger `set_time_entry_review_flag`:** open entries exceeding **12 h** OR reaching **midnight (00:00, Europe/Berlin)** become `requires_review = true` + `is_approved = false`; a normal clock-out or admin approval resets the flag
- Housekeeping function `flag_overdue_time_entries()` flags overdue entries "silently" (called on every read/write of time data)
- **Minimum-break trigger `enforce_min_break` (§ 4 ArbZG):** on every write with `clock_out` the presence time is checked and the recorded break is raised to the legal minimum – **> 6 up to 9 h → 30 min, > 9 h → 45 min** (never reduced). Backfill raises existing data. Net working time = `(clock_out − clock_in) − break_duration_minutes`

### `time_entry_audit_logs` – revision-safe change log
- `id`, `time_entry_id` (FK, `on delete set null` – the log survives deletion), `changed_by_user_id` (FK, `on delete set null`)
- `changed_at`, `old_values` / `new_values` (jsonb), `change_reason`
- Written **server-side** whenever an admin edits, closes, approves or deletes an entry (including offline changes via `/api/sync`) and when an employee submits a forgotten clock-out or submitted work time; no-op updates are skipped
- RLS: read for admins only; writes via the service role

### `time_off_requests` – absence requests
- `id`, `user_id` (FK cascade), `type`, `start_date`, `end_date`
- `status`, `reviewer_note`, `employee_note`
- `substitute_id`, `substitute_request` (boolean), `substitute_kind` (`driver` | `facility_manager`), `substitute_object_id`
- Substitute suggestions are stored with `substitute_request = true` and `status = pending`; admin approval activates them
- LWW fields; triggers book approved vacation days into `vacation_days_used`: `calculate_time_off_workdays(user, start, end)` counts Monday–Friday and scales proportionally to `working_days_per_week`; `recalculate_vacation_days_used(user)` sums only **approved** vacation requests of the **current calendar year**, clamped to `[year start, year end]`
- Trigger `sync_vacation_days_used` on insert/update/delete, plus a trigger on `working_days_per_week` changes; earlier calendar-day-based triggers were removed

### `objects` – customer sites / stairwells
- `id`, `name`, `address`, `category`
- `is_pedestrian_zone_until_11` – pedestrian zone (detected via Overpass, no manual checkbox): direct approach only until 11:00, otherwise via the nearest drivable stop + walk
- `opens_at` (time, nullable) – **may only be approached from this time onwards**
- `latitude`, `longitude` (ORS-verified coordinates, nullable)
- `key_number` (integer, nullable)
- `customer`, `customer_number`, `cleaning_interval` – **admin-only** info
- `remark` – visible to all roles, editable by admins only (e.g. access notes)
- `last_delivery_at`, `last_delivery_driver_name`, `last_delivery_items` (jsonb) – set when a tour is completed
- LWW fields

### `object_assignments` – object assignments (m:n user ↔ object)
- `user_id` (FK cascade), `object_id` (FK cascade), `created_at`; PK `(user_id, object_id)`
- Controls visibility for **cleaners** (`facility_manager`): they only see assigned objects and their items – online and offline. At least one assignment is mandatory when creating a cleaner.

### `object_items` – items of an object
- `id`, `object_id` (FK cascade), `item_name`
- `is_always_required` – fixed and greyed out in pack/tour mode
- `quantity` (default 1), `note`, `photo_path` (storage)
- `is_reserved` – one-off reservation for the next delivery (reset after delivery)
- LWW fields; no unique constraint on `(object_id, item_name)`

### `inventory_items` – item catalogue (admin only)
- `id`, `name`, `note`, `created_at`, `updated_at`
- RLS: read for all authenticated users, manage (create/edit/delete) for admins only
- Seeded with an initial item list

### `chat_threads`, `chat_messages`, `chat_translations` – communication
- `chat_threads` links one employee with one admin; exactly one thread per pair
- `chat_messages`: text, image and audio with status `sent`/`delivered`/`read`, `is_urgent`, `transcript`, `media_path`, `media_mime_type`
- `chat_translations` caches translations per message and target language
- Storage bucket `chat-media` is private; media is delivered via short-lived signed URLs
- Realtime publication covers threads, messages and translations; the summary query returns contacts, threads and the unread count

### `push_subscriptions` & `company_settings`
- `push_subscriptions` stores web-push endpoints per user; invalid endpoints are removed on send
- `company_settings` holds the optional central support phone number (call button in the chat)

### `active_tours` + `tour_stops` – tours
- `active_tours`: `id`, `driver_id`, `date`, `status` (`packing` → `in_transit` → `completed`), `start_time`, `warehouse_arrival` (planned return to the warehouse), `total_duration_minutes`
- `tour_stops`: `id`, `tour_id` (FK cascade), `object_id` (**nullable** for temporary targets), `stop_order` (unique per tour), `arrival_time`, `is_delivered`, `key_number` (explicitly selected in pack mode), `next_delivery_items` (jsonb – items reserved for the **next** delivery), `delivered_items` (jsonb snapshot of what was actually delivered)
- **Undeliverable stops:** `is_undeliverable` (bool) + `undeliverable_reason` (text) – a stop can be closed without delivery (site closed, access denied, key missing). Delivery and "not deliverable" are mutually exclusive; the existing triggers (last delivery, `is_reserved` reset) only fire on real delivery
- **Temporary/unknown targets:** `is_unknown`, `unknown_target_id` (client id), `unknown_name`, `unknown_address`, `unknown_latitude`, `unknown_longitude` – snapshots only of the tour stop, no `objects` entry, visible for this tour only (incl. history), removed when the tour is deleted or when re-planning without the target
- Trigger `update_last_delivery_on_tour_completed` writes `last_delivery_*` on the objects when the tour is completed; trigger `reset_reserved_items_after_delivery` clears `is_reserved`

### Passkeys & challenges
- `passkeys`: `id`, `user_id` (FK cascade), `credential_id` (unique), `public_key` (base64url), `counter`, `transports` (jsonb), `last_used_at` – strictly per user
- `webauthn_challenges`: `id`, `challenge`, `user_id` (null for login), `purpose` (`registration` | `authentication`), `expires_at` – deleted after verification

### Storage
- `item-photos` (public read, write for authenticated users) – item photos (`items/<uuid>.jpg|png|webp|heic`), max 10 MB per upload
- `chat-media` (private) – chat images and audio, delivered via signed URLs

---

## 5. Auth, roles & security

**Login methods**
- **Username + password** (`POST /api/auth/login`) – username mapped to `{name}@<domain>`; password min. 8 characters
- **Passkeys (WebAuthn)** – fingerprint/Face ID. Registration only while logged in (`register-options`), login via discoverable credentials (`login-options`/`login-verify`). A passkey is bound to exactly one user; the session at passkey login is created via a magic-link token (no email is sent)

**Roles**

| Role | Rights |
| :--- | :--- |
| `admin` | Everything: objects, photo import, OCR, user management, planning, tours, item photos, time admin, chat with all employees |
| `facility_manager` | **Cleaner**: sees ONLY assigned objects (name, address, key, category, items) read-only; no planning, no user management, no create/edit/delete |
| `driver` | Tour planning, pack mode, tour mode, history (own tours) |
| `substitute` | **Substitute**: sees everything like a driver (objects incl. last delivery/info, planning, history) – no object assignment required; additionally has the substitution page and calendar |

**No public registration** – users are created exclusively by admins via user
management (`/api/auth/users`, admin only). The seed admin (migration
`20260801000004_seed_admin.sql`) is `Admin` / `bitte-aendern!` (change after the
first login).

**Three layers of protection**
1. **Middleware** (`src/middleware.ts`): protects all routes except `/login` and the passkey login APIs. Pages → redirect to `/login?next=…`; API routes → `401 UNAUTHENTICATED`
2. **API guards**: every route checks `requireUser()` + role (`isAdmin` / `isPlanner` / `isFacilityManager`), plus tour-owner checks. **Cleaners:** `/api/objects*` returns only assigned objects (without last-delivery fields), item/photo/pack endpoints are limited to assigned objects and read-only (403)
3. **RLS** in the database (`auth.uid()` / `current_user_role()`), about 50 policies: passkeys only for the owner; `objects`/`object_items` role-aware (cleaners only assigned rows, writes admins only); `object_assignments` admin-managed with self-read; `time_entries`/`time_off_requests` user-bound (own rows + admin; approvals admins only); audit log read admins only

---

## 6. Core features & workflows

### 6.1 Object management (`/objects`)
- CRUD for objects (name, address, category, opening time, key number, remark, admin info: customer, customer number, cleaning interval) – admins only
- **Search + sorting** by attribute: name/address (A–Z/Z–A), key no. (asc/desc), category, number of items
- **Address autocomplete** via ORS (`/api/geocoding/autocomplete`) + **verification** on save (`/api/geocoding/verify`); district suffixes are normalised for geocoding
- **Pedestrian zone is detected automatically on save via Overpass** (no checkbox)
- Items per object: name, quantity, note, **photo upload** (`/api/items/photo`, 10 MB); item photos are compressed client-side to max. 3072 px
- **Info dialog** shows last delivery (date, driver, delivered items) and admin info
- **Cleaners (`facility_manager`):** see only assigned objects; table columns reduced to name, address, key, category, items (no "last delivery"/"info"); the item dialog is read-only (no editing, no photo upload)

### 6.2 Photo import (AI, admin)
Three import types via `/api/objects/import/*` (Gemini OCR):
- **Objects** (`objects/analyze` + `objects`): photographed address lists → preview with duplicate detection (normalised address + fuzzy match), ORS geocoding status per entry, pedestrian-zone check (OCR hint **or** Overpass)
- **Keys** (`keys/analyze` + `keys`): recognised key numbers → assignment to existing objects (dropdown shows existing key numbers) or **"create new object…"** (name/address, geocoded + pedestrian-zone check, duplicate protection via existing addresses)
- **Items** (`items/analyze` + `items/import`): photographed packing lists with object name, customer, customer number, cleaning interval and items → preview; **only creates new objects with their items**, existing objects are never edited (similar existing records are returned as a warning only). The **import runs asynchronously in the background** (`maxDuration = 300`): `POST items/import` accepts the job immediately with `202` and writes objects + items via Next.js `after()` hooks; errors (e.g. objects created but item batch failed) are reported via **push notification** (tag `photo-import-failure`, `always`), so the app stays usable and the next import can start in parallel
- Additional single-item OCR: `/api/items/ocr` converts a photographed packing list into structured items for the item dialog (admin only, 10 MB, 60 s max)

### 6.3 Inventory (`/inventory`, admin)
- Item catalogue (name + note) used as a suggestion pool for object items
- Search, create, edit inline, delete

### 6.4 Tour planning (`/planning`)
- **Manual selection:** objects are selected per tour (weekday pre-selection/saving was removed). A counter `selected/total` (e.g. "5/42") shows progress
- **Unknown destinations:** a single button "+ Unknown destination" creates a temporary target. The address is set via **autocomplete** – only a selected suggestion is saveable (valid address + coordinates); a maps icon opens the address as a search in Google Maps. New targets appear at the top under "Unknown destinations (x)", are selected automatically, can be toggled by checkbox or row tap, and the pencil button opens the dialog to edit/delete. They take part in route calculation, have no item dialog, are directly tickable as delivered in tour mode and listed in history with name + address (without items/keys). Storage: current tour only (sessionStorage); app restart or tour start clears them; re-planning keeps only selected targets
- **Photo selection** (`/api/planning/photo`): photographed route list → ticks set automatically (match by address/name, unmatched entries listed)
- **Clock-in check before planning:** when calculating the route the app checks for an open clock-in. If none exists, a dialog offers "clock in first" (directly in the dialog, selection is preserved) or "continue without clock-in"
- **Start time** automatically (current time + preparation time, rounded up to 5 minutes) – no manual field
- **Search** by name/address, grouped into objects and stairwells, with badges for pedestrian zone, opening time and remark

### 6.5 Route optimisation (`/api/planning/optimize`)
Implemented in `src/lib/routing/optimizer.ts`:

1. **Primary: ORS Optimization API (VROOM)** – jobs with time windows, vehicle from the warehouse
   - **Live traffic:** if `TOMTOM_API_KEY` (or `STADIA_API_KEY`) is set, the travel-time matrix is requested first and passed to VROOM as a custom matrix; result `traffic_matrix_provider: "tomtom" | "stadia"`
   - Limits: VROOM tested up to 50 jobs; ORS matrix up to 20 locations; TomTom 100 locations / 2500 cells (free tier), controlled via `TOMTOM_MAX_CELLS`
2. **Fallback:** ORS matrix → Google matrix → Haversine + own TSP solver (`solveTspWithWindows`)
3. **Time windows:** `opens_at` → earliest arrival; pedestrian zone → **two variants** are calculated: (A) directly to the object, only until 11:00 (deadline 11:00); (B) via the nearest drivable stop found by Overpass (`findNearestDrivablePoint`) + remaining distance on foot (no deadline)
4. **The faster variant wins:** walking time (≈ 5 km/h) is included when comparing variant B. Variant B stops show "x m on foot" (`approach_by_foot`); if A is infeasible, B wins automatically (if a stop was found)
5. **Preparation time** at the warehouse: 4 min/stop + 5 min keys (`prep_begin` = departure − preparation)
6. **Service time per target** by category: stairwell 6 min, object 7 min (objects are calculated with 1 min less parking time; service time flows into VROOM/TSP and arrival/departure times)
7. Warnings (e.g. infeasible restrictions, traffic fallback) as `warnings[]`

Result (`RouteOptimizationResult`): `mode` (`ors-optimization` | `ors-matrix` | `google-matrix` | `haversine`), sorted stops with arrival/departure, coordinates, total duration, warehouse. In **demo mode** (no ORS key) coordinates are `null` – no invented hash coordinates.
- **Coordinate persistence:** freshly geocoded object addresses (no hash fallback) are **stored permanently in the DB** by the optimisation – subsequent optimisations and the pack/tour map use them without re-geocoding
- Stops without coordinates get DB/geocode coordinates backfilled so the map stays consistent with the list

### 6.6 Pack mode (`/planning` after optimisation)
- Stop timeline with arrival times, **green/red status badge** ("route optimised" / "optimisation failed")
- **Estimated end of work** is displayed (warehouse return + clean-up time: 4 min/stop + 5 min)
- **Key selection:** a button "Select keys" opens a dialog with all objects of the tour and their key numbers (checkbox per object, multi-select, confirm closes). After confirmation the button shows "Keys: no. x, no. y, …" and stays tappable for corrections. Only confirmed keys are stored with the tour, shown in tour mode and listed in history under "keys taken"
- Click on a stop → **packing list** (`/api/objects/[id]/pack-info`): standard items + reserved extra items of the last tour; items with a photo are tappable (image view); the item list shows the object's key number at the top
- **Map at the bottom** (Leaflet): round trip warehouse → all stops → warehouse incl. return leg, numbered markers, walking sections
- **"Start driving"** → creates the tour (`/api/tours`, status `in_transit`) with the **actual current time** as start; planned arrival times and warehouse arrival are shifted by the delta; selected keys and unknown-target snapshots are stored; then the app switches to tour mode
- Pack draft is kept in `sessionStorage` (per user), so a tab switch or reload does not lose the planning; an **active tour banner** offers direct re-entry and deletion

### 6.7 Tour mode (`/tour/[id]`)
- Stops in optimised order with progress bar, **map at the bottom** (delivered stops green with a tick; undeliverable stops marked)
- Click on a stop → item list: standard items fixed/checked/greyed out, variable items selectable for the **next delivery** (stored as `next_delivery_items`), optional note per reserved item; object remark shown; "Requested today" badge for items reserved on the previous tour
- Object stops show a badge "No. x" with the key number selected in pack mode
- **Unknown destinations** are shown too (name + address, no item dialog) and can be marked as delivered directly with the check button
- **"Not deliverable"**: a stop can be closed with an optional reason (site closed, access denied, key missing). Delivery and "not deliverable" exclude each other and can be undone ("mark as open")
- **"Delivery done"** → marks the stop as delivered (stores a `delivered_items` snapshot: standard items + reserved/due extras, including items no longer in the catalogue); when all stops are resolved (`delivered + undeliverable = total`), the tour can be completed → status `completed`, `last_delivery_*` written on the objects
- **Map completeness:** objects without stored coordinates are geocoded once when the tour loads (`GET /api/tours/[id]`) via Photon/ORS and **persisted in the DB** (3 s timeout, does not block the response)

### 6.8 History (`/history`)
- Past tours with date, driver, number of delivered stops and objects (`GET /api/tours`)
- **Search** across driver, object, address, date, key number, undeliverable reasons and unknown destinations
- **Unknown destinations** are shown as their own section with name + address (without items/keys); key numbers of the tour appear under "Keys taken"; undeliverable stops with reason are listed separately
- Customers of delivered objects are shown to admins only
- Admins may delete any tour; drivers/substitutes may delete their own, not yet completed tour (incl. the "active tour" banner); deletion cascades to stops

### 6.9 Substitution (`/substitutes`, role `substitute`; admin management in time admin)
- Substitutes see their assignments in a **calendar** (previous/next period) with the absent employee, kind (driver/cleaner), object and period; clicking a day opens details
- **Substitutes can submit their own substitution suggestions** (`POST /api/time-tracking/substitutes`): affected employee (optional), period, kind, object (for cleaners) → stored as `time_off_requests` with `substitute_request = true`, status `pending`
- Admins confirm/edit/remove substitutions in the time admin; on save/update the substitute receives a **push notification** ("New substitution" / "Substitution updated", link `/substitutes`)

### 6.10 Chat (`/chat`)
- Contact list with search and role filter, unread badge in the header; admin broadcast to several employees with confirmation
- Messages with text, image and audio attachments, **urgent messages**, status ticks (`sent`/`delivered`/`read`), time and translation
- **Audio transcription** (`/api/chat/transcribe`, Gemini) so voice messages are readable; transcripts are stored on the message
- **Translation** (`/api/chat/translate`): per message into a target language, cached in `chat_translations`; the personal preferred language is stored in `profiles.chat_preferred_language` (`/api/chat/preferences`)
- **Call button:** admins can call the employee's stored phone number, employees can call the central support number from `company_settings`
- **Push notifications** (`/api/chat/push`, VAPID): subscription is set up app-wide after login (once), invalid endpoints are removed on send; payload supports `tag` and `always` (show even when a tab is visible)
- Thread view is a master-detail navigation on mobile (list or conversation, with back navigation); own messages right-aligned blue bubbles (max. 75 % width), received messages left
- **Offline-first:** messages are cached in IndexedDB and synchronised from an upload queue; the thread index and batch writes reduce load time

### 6.11 Settings (`/settings`)
- **Profile:** username (login identifier), display name, phone number
- **Password change** (`/api/auth/me-password`, min. 8 characters)
- **Passkeys:** register/delete own passkeys (list with created/last used)
- **Company contact (admin):** central support number for the chat call button (`/api/chat/config` PATCH)
- **User management (admin):** create accounts (username, password, role, **contract type**, target hours/days/vacation, object assignment for cleaners – at least 1), change role, **change contract type**, edit contract values (target hours 1–168, working days 1–7, vacation days 0–365), reassign objects
- **Contract auto-fill:** full time 40/5/30, part time 20/5/30, mini job 10/2/12; `custom` (or "Individuell") shows target hours and working days as inputs; vacation entitlement suggested as `round(30 × working days ÷ 5)` and always manually adjustable

### 6.12 Time tracking & absence management
**Time clock (visible on every page):** `ClockWidget` in the header (desktop) or in the bottom bar (mobile). Clock in/out, pause toggle + fixed pause presets (+15/30/45/60 min), live counter, browser reminder "forgot to clock out?" (after 8 h or from 17:00 with ≥ 1 h, once per clock-in). **Offline-first** via IndexedDB + LWW (`client_updated_at`, server time alignment via `/api/time`).

**Employee dashboard (`/time-tracking`):**
- Week/month totals and **overtime account** (automatic target/actual comparison based on `weekly_target_hours`; only approved, completed entries and completed weeks count; **only positive overtime** is accumulated – no negative hours, running weeks do not count yet) + manual admin correction
- **Remaining vacation** = `vacation_days_per_year − vacation_days_used`
- **Submit work time** (forgotten clock-in) → entry with `source = submitted`, `is_approved = false` → waits in the approval feed
- **Absence requests** (vacation, sick leave, unpaid, time off in lieu) with status display and optional substitute selection

**Auto-timeout & review queue (forgotten clock-out):**
- An open clock-in exceeding **12 h** or reaching **midnight (Europe/Berlin)** becomes `requires_review = true` + `is_approved = false` (DB trigger on writes, housekeeping `flag_overdue_time_entries` on every access)
- Such entries do **not** count towards week/month totals or the overtime account until approved
- **Forced popup on app start:** unresolved, still open review entries trigger a **non-dismissible** dialog with actual end time, break and note (`PATCH /api/time-tracking/entries/[id]`). Submitting closes the entry (`source = submitted`) → "submitted / waiting for approval"; the popup disappears once the entry is closed or approved; re-check on tab focus

**Break automation (§ 4 ArbZG):** presence time **> 6 up to 9 h → at least 30 min break, > 9 h → at least 45 min**. The recorded break is automatically raised to the minimum (never reduced) – the DB trigger covers all write paths (time clock, offline sync, submission, admin correction). Net working time = `(clock_out − clock_in) − break`.

**Time admin (`/admin/time-tracking`):**
- **Employee status:** list or calendar view; who is clocked in right now, current tour/next object, overtime, contract; search filter; absence calendar with employee search filter and "add absence"
- **Monthly overview:** total working time of all employees for the selected month (approved, completed entries); mini-job limit colouring (orange ≥ 85 %, red ≥ 100 %), click a row to filter
- **Needs review:** all flagged open clock-ins with live duration; "clock out & approve" (end time, break, note, optional change reason – closes, enforces the minimum break, sets `is_approved = true`) and "delete"
- **Approval feed:** closed but unapproved entries ("submitted work time" / "forgotten clock-out") and open requests, with icon + status badge
- **Change log (audit log):** every admin edit/approval/deletion is logged revision-safe (old→new snapshot, editor, timestamp, reason – "offline change (sync)" for offline changes); employees' submissions are logged too. Edited entries show a history icon with tooltip ("{reason} by X on DD.MM.YYYY at HH:MM"); clicking opens a dialog with all changes incl. field diff
- Add/edit entries (with mandatory reason for the audit log), delete, vacation/overtime corrections; **payroll CSV export** (`/api/admin/time-tracking/export`, UTC times rendered in `Europe/Berlin`, weekday-aware)

### 6.13 Performance instrumentation
`src/lib/perf.ts` instruments all item lists (tour, delivery dialog, pack dialog, items dialog, inventory, history, planning) with stale-while-revalidate marker (cache state vs. network), row count and network type. Logging only in the dev console for values > 1 s; no UI, no behavioural impact.

---

## 7. Offline-first & synchronisation

- Syncable tables: `profiles`, `objects`, `object_items`, `inventory_items`, `active_tours`, `tour_stops`, `time_entries`, `time_off_requests`
- Offline writes are stored in IndexedDB as `pending_upload` and synchronised on reconnect via `POST /api/sync`. Last-write-wins uses `client_updated_at`; on conflicts the client adopts the server record. Server time is aligned via `GET /api/time`.
- The sync engine processes tables in dependency order (tours before tour stops), in batches, and protects local changes made during a running sync.
- Deletions, photo/OCR import, authentication, password/passkey management and user creation remain online-only. Read endpoints are served from IndexedDB where available; the service worker caches the app shell but does not intercept `/api/*`.
- Key selection and unknown destinations work fully offline: the sync whitelist for `tour_stops` includes `key_number`, `is_unknown` and the unknown-target columns; offline history/tour view reconstructs them from the cache. Address autocomplete for new suggestions requires a connection.
- **Hover prefetch:** hovering/focusing a nav link preloads the page's data endpoint into the IndexedDB cache (debounced + deduped) so the page renders from cache immediately.
- Performance: cache writes run as one read + one write transaction per table (instead of two per row); the offline queue reads pending entries via a `sync_status` index; the history/tour assembler groups stops once per `tour_id`.
- The sync/offline indicator in the header shows online/offline, running sync, pending entries, last sync and errors.

## 8. Maps (Leaflet)

- `src/components/map/route-map.tsx` – imperative Leaflet (only inside `useEffect`, SSR-safe), OSM tiles (free)
- Road geometry via **ORS Directions** (`POST /api/planning/route-geometry`, bearer auth, polyline decoder in `src/lib/polyline.ts`); fallback: dashed straight lines
- Used in pack mode and tour view; autofit to all points; only stops with coordinates are shown
- `NavigateButton` opens the stop address coordinates in the device's maps app

## 9. API overview (all protected, role in brackets)

**Auth:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me-profile` · `POST /api/auth/me-password`
**Passkeys:** `POST /api/auth/passkeys/login-options` (public) · `login-verify` (public) · `register-options` · `register-verify` · `DELETE /api/auth/passkeys/[id]`
**Users (admin):** `GET/POST /api/auth/users` · `PATCH/DELETE /api/auth/users/[id]`
**Geocoding:** `POST /api/geocoding/autocomplete` · `POST /api/geocoding/verify`
**Objects (admin; cleaner read-only):** `GET/POST /api/objects` · `GET/PATCH/DELETE /api/objects/[id]` · `GET/POST /api/objects/[id]/items` · `PATCH/DELETE /api/objects/[id]/items/[itemId]` · `GET /api/objects/[id]/pack-info`
**Inventory (admin):** `GET/POST /api/inventory` · `PUT/DELETE /api/inventory/[id]`
**Import (admin):** `POST /api/objects/import/objects[/analyze]` · `…/keys[/analyze]` · `…/items[/analyze]` · `POST /api/objects/import/items/import` (async, `202`, result/error via push) · `POST /api/items/ocr` · `POST /api/items/photo`
**Planning (driver/admin/substitute):** `GET /api/planning` · `POST /api/planning/optimize` · `POST /api/planning/photo` · `POST /api/planning/route-geometry`
**Tours (driver/admin/substitute):** `GET/POST /api/tours` · `GET/PATCH/DELETE /api/tours/[id]` · `PATCH /api/tours/[id]/stops/[stopId]`
**Time tracking (logged in):** `GET/POST /api/time-tracking/clock` · `GET/POST /api/time-tracking/entries` · `PATCH /api/time-tracking/entries/[id]` · `GET /api/time-tracking/review` · `GET /api/time-tracking/summary` · `GET/POST /api/time-tracking/requests` · `PATCH /api/time-tracking/requests/[id]` · `GET/POST /api/time-tracking/substitutes`
**Time admin (admin):** `GET /api/admin/time-tracking/overview` (incl. `audit_logs` per entry) · `GET /api/admin/time-tracking/status` · `GET /api/admin/time-tracking/export` (payroll CSV) · `POST /api/admin/time-tracking/entries` · `PATCH/DELETE /api/admin/time-tracking/entries/[id]`
**Chat:** `GET/PATCH /api/chat/config` · `GET /api/chat/contacts` · `GET/POST /api/chat/messages` · `PATCH /api/chat/preferences` · `POST /api/chat/push` · `GET /api/chat/summary` · `GET/POST /api/chat/threads` · `POST /api/chat/transcribe` · `POST /api/chat/translate`
**System:** `POST /api/sync` (LWW sync) · `GET /api/time` (server time)

## 10. Deployment & database

- `npm ci` → `npm run dev` (http://localhost:3000) · `npm run build` · `npm run typecheck`
- Database: 42 migrations in `supabase/migrations/` in filename order (`supabase db push`), or `supabase/setup.sql` once in the SQL editor (contains all migrations in order, including the seed admin)
- Seed admin: username `Admin`, password `bitte-aendern!` – change after the first login
- **Freebuff Sites / Cloudflare Workers:** the folder is prepared for the OpenNext adapter (`freebuff.open-next.config.ts`, `freebuff.wrangler.jsonc`). `NEXT_PUBLIC_*` values must be set before the build (they are compiled in); server-only values (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ORS_API_KEY`, `VAPID_*`) are read at runtime from the Worker environment and can be stored as Sites secrets
- Migrations must be applied before the first request; versions must be unique

## 11. Project structure (excerpt)

```
RAW_EN/
  src/middleware.ts                  # session refresh + page/API protection
  src/app/page.tsx                   # redirect: drivers/substitutes → /planning, others → /objects
    login/ · objects/ · inventory/ · planning/ · tour/[id]/ · history/ · chat/
    settings/ · time-tracking/ · substitutes/ · admin/time-tracking/
  src/app/api/                       # 58 route handlers (auth, users, passkeys, geocoding, items,
                                     # objects incl. import/*, inventory, planning, tours, chat,
                                     # time-tracking incl. admin/*, sync, time)
  src/components/
    app-shell.tsx                    # header navigation (role-dependent), time clock, sync badge, push setup
    map/route-map.tsx                # Leaflet route map
    objects/                         # object management + photo import dialogs
    inventory/                       # item catalogue (admin)
    planning/                        # planning, pack mode, photo selection, key dialog, unknown targets
    tour/                            # tour mode, delivery dialog, navigation button
    chat/                            # contacts, thread view, media, push, offline queue
    time-tracking/                   # clock widget, dashboard, time admin, review popup, absence calendar
    substitute/                      # substitution page + calendar
    settings/ · history/ · auth/ · ui/
  src/lib/
    company.ts · warehouse.ts · region.ts   # company/warehouse/service-area configuration
    auth.ts · webauthn.ts                   # auth, roles, passkey verification
    ors.ts · photon.ts · address.ts · overpass.ts   # geocoding, address normalisation, pedestrian zones
    ocr.ts · gemini-chat.ts                  # photo import, transcription, translation
    traffic-matrix.ts · stadia-matrix.ts     # live-traffic matrices
    routing/optimizer.ts · routing/tsp.ts · routing/time.ts   # VROOM + matrix + TSP + time windows
    contract.ts · time-format.ts · time-tracking.ts           # target/actual, overtime, ArRZG breaks, audit
    offline/                        # db, fetch, sync, clock, chat
    lww.ts · sync-tables.ts         # last-write-wins registry and syncable tables
    perf.ts · realtime.ts · storage.ts · image-upload.ts
  supabase/migrations/              # 42 versioned schema/performance migrations
  supabase/setup.sql                # all migrations in one file for the SQL editor
```

## 12. Known state & limitations

- **UI language:** English, but a number of legacy German strings remain (e.g. "Anzeigename", "Kategorie", "Admin-Info", "Belieferte Objekte", "Nicht lieferbar", "Keys taken", "Neue Item", "Firmenkontakt", "Synchronisiert…"). They are cosmetic and do not affect behaviour.
- **Legal defaults are German:** break automation and vacation accounting follow ArbZG/BUrlG (30/45 min breaks, 30 days at 5 days/week). Other jurisdictions need different rules in the DB triggers.
- **Hard-coded time zone:** time evaluation and the payroll export use `Europe/Berlin` (including the CSV export).
- **Template scope:** single company per deployment – there is no multi-tenant separation; branding, warehouse and service area come from environment variables.
- **Demo mode:** without `ORS_API_KEY` the optimisation falls back to Haversine with `null` coordinates (no invented positions on the map).
- **Chat** requires `VAPID_*` for push and `GEMINI_API_KEY` for transcription/translation; without keys these features degrade gracefully.
