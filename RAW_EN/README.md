# Company App (RAW_EN) – object, tour and time tracking app

Next.js 16 / Supabase app for delivery and cleaning round trips. This folder is
the **English-language, company-independent template**: same feature set as the
German variant, but without a company name, without a fixed warehouse and without
a fixed service area.

## Start

```bash
npm ci
cp .env.local.example .env.local   # fill in the values
npm run dev                        # http://localhost:3000
npm run typecheck
```

Database: apply the migrations in `supabase/migrations` to a Supabase project in
filename order (`supabase db push`, or `supabase/setup.sql` in the SQL editor).
The migration `…_seed_admin.sql` creates the first admin
(username `Admin`, password `bitte-aendern!` – change it after the first login).

## Adapting it for another company

All company and region values come from environment variables – no code changes
required.

| Variable | Effect | File |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_COMPANY_NAME` | Name in header, login, page title, passkey | `src/lib/company.ts` |
| `NEXT_PUBLIC_COMPANY_SLUG` | Prefix of the payroll export filenames | `src/lib/company.ts` |
| `NEXT_PUBLIC_USER_EMAIL_DOMAIN` | Login identifier `user@domain` | `src/lib/company.ts` |
| `NEXT_PUBLIC_WAREHOUSE_NAME`, `WAREHOUSE_ADDRESS` | Warehouse (start/end of the round trip) | `src/lib/warehouse.ts` |
| `NEXT_PUBLIC_SERVICE_CITY` | City added to addresses without one | `src/lib/region.ts` |
| `NEXT_PUBLIC_SERVICE_CITY_LAT` / `_LON` | Location bias for the geocoding search | `src/lib/region.ts` |
| `NEXT_PUBLIC_SERVICE_AREA_BOUNDARY` | Search boundary `minLon,minLat,maxLon,maxLat` | `src/lib/region.ts` |

Other knobs:

- **Pedestrian zone fallback** (when Overpass is unreachable):
  `PEDESTRIAN_FALLBACK_POLYGONS` in `src/lib/region.ts`.
- **Colours/icon**: `themeColor` in `src/app/layout.tsx`, `src/app/icon.svg`.
- **Other fields/texts**: everything else lives in `src/components` and `src/app`.

## Deployment on Freebuff Sites (Cloudflare Workers)

This folder is prepared for the Sites adapter (Next.js + OpenNext,
`freebuff.wrangler.jsonc`). Two things to note:

- `NEXT_PUBLIC_*` values are compiled into the code at **build** time.
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the
  `NEXT_PUBLIC_COMPANY_*` / `NEXT_PUBLIC_SERVICE_*` values must therefore be set
  before the build – changing them later requires a new build.
- Non-public values (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ORS_API_KEY`,
  `VAPID_*`, …) are read at runtime from the Worker environment and can be stored
  as Sites secrets.
- Database: run `supabase/setup.sql` once in the Supabase SQL editor (contains all
  migrations in order).

## Structure

- `src/app` – pages (App Router) and API routes
- `src/components` – UI components
- `src/lib` – domain logic (routing, geocoding, offline sync, auth, time tracking)
- `supabase/migrations` – database schema including RLS

The frontend language is English. This template targets the **UK market**: the
statutory break follows the Working Time Regulations 1998 (20 minutes once the
working day exceeds 6 hours), all timestamps and the payroll export use
`Europe/London`, and the export uses English weekday codes. Vacation entitlement
still uses the German default. SPEC.md § 12.1 lists every deliberate deviation
from the German original and the reason for it.
