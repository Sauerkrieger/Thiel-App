# Firmen-App (RAW) – Objekt-, Touren- und Zeiterfassungs-App

Next.js-16/Supabase-App für Liefer- und Reinigungsrundtouren. Dieser Ordner ist
die **firmenunabhängige Vorlage**: derselbe Funktionsumfang wie `../THIEL`,
aber ohne Firmennamen, ohne festes Lager und ohne festes Einsatzgebiet.

## Start

```bash
npm ci
cp .env.local.example .env.local   # Werte eintragen
npm run dev                        # http://localhost:3000
npm run typecheck
```

Datenbank: die Migrationen aus `supabase/migrations` in Dateinamen-Reihenfolge
auf ein Supabase-Projekt anwenden (`supabase db push` oder SQL-Editor). Die
Migration `…_seed_admin.sql` legt den ersten Admin an
(Benutzername `Admin`, Passwort `bitte-aendern!` – nach dem ersten Login ändern).

## An eine andere Firma anpassen

Alle Firmen- und Regionswerte kommen aus Umgebungsvariablen – Code muss dafür
nicht geändert werden.

| Variable | Wirkung | Datei |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_COMPANY_NAME` | Name in Header, Login, Seitentitel, Passkey | `src/lib/company.ts` |
| `NEXT_PUBLIC_COMPANY_SLUG` | Präfix der Lohnexport-Dateinamen | `src/lib/company.ts` |
| `NEXT_PUBLIC_USER_EMAIL_DOMAIN` | Login-Kennung `benutzer@domain` | `src/lib/company.ts` |
| `NEXT_PUBLIC_WAREHOUSE_NAME`, `WAREHOUSE_ADDRESS` | Lager (Start/Ziel der Rundtour) | `src/lib/warehouse.ts` |
| `NEXT_PUBLIC_SERVICE_CITY` | Stadt für Adressen ohne Ortsangabe | `src/lib/region.ts` |
| `NEXT_PUBLIC_SERVICE_CITY_LAT` / `_LON` | Standort-Bias der Geocoding-Suche | `src/lib/region.ts` |
| `NEXT_PUBLIC_SERVICE_AREA_BOUNDARY` | Suchgrenze `minLon,minLat,maxLon,maxLat` | `src/lib/region.ts` |

Weitere Stellschrauben:

- **Fußgängerzonen-Fallback** (wenn Overpass nicht erreichbar ist):
  `PEDESTRIAN_FALLBACK_POLYGONS` in `src/lib/region.ts`.
- **Farben/Icon**: `themeColor` in `src/app/layout.tsx`, `src/app/icon.svg`.
- **Eigene Felder/Texte**: alles Weitere liegt in `src/components` und `src/app`.

## Deployment auf Freebuff Sites (Cloudflare Workers)

Der Ordner ist für den Sites-Adapter vorbereitet (Next.js + OpenNext, `freebuff.wrangler.jsonc`). Zwei Dinge sind dabei zu beachten:

- `NEXT_PUBLIC_*`-Werte werden beim **Build** in den Code eingetragen. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` und die `NEXT_PUBLIC_COMPANY_*` / `NEXT_PUBLIC_SERVICE_*`-Werte müssen deshalb schon beim Build gesetzt sein — eine Änderung danach braucht einen neuen Build.
- Nicht-öffentliche Werte (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ORS_API_KEY`, `VAPID_*`, …) liest der Worker zur Laufzeit aus der Umgebung und können als Sites-Secret hinterlegt werden.
- Datenbank: `supabase/setup.sql` einmalig im Supabase SQL-Editor ausführen (enthält alle Migrationen in Reihenfolge).

## Aufbau

- `src/app` – Seiten (App Router) und API-Routen
- `src/components` – UI-Komponenten
- `src/lib` – Fachlogik (Routing, Geocoding, Offline-Sync, Auth, Zeiterfassung)
- `supabase/migrations` – Datenbankschema inkl. RLS

`THIEL/` ist der produktive Stand und bleibt die führende Codebasis.
