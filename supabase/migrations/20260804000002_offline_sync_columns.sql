-- =============================================================
-- Thiel Dienstleistungen – Offline-First-Sync (LWW)
-- Migration: client_updated_at / synced_at / updated_at
--
-- Änderungen:
--   1. set_updated_at() bevorzugt künftig client_updated_at
--      (updated_at = client_updated_at, falls gesetzt; sonst now())
--   2. Neue Spalten auf allen synchronisierbaren Tabellen:
--        client_updated_at timestamptz  (LWW-Basis, Client-Zeitstempel)
--        synced_at         timestamptz  (Serverzeit des letzten Syncs)
--   3. object_items & tour_stops erhalten zusätzlich ein bislang
--      fehlendes updated_at (inkl. Trigger)
--
-- Hinweis: Keine sync_tombstones-Tabelle – Löschen passiert bewusst
-- nur online (siehe OFFLINE_SYNC_PLAN.md).
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Trigger-Funktion: updated_at bevorzugt client_updated_at
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.client_updated_at is not null then
    new.updated_at = new.client_updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- 2. Neue Spalten je Tabelle
-- ------------------------------------------------------------------

-- profiles
alter table public.profiles
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.profiles.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.profiles.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- objects
alter table public.objects
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.objects.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.objects.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- object_items (bekommt zusätzlich updated_at)
alter table public.object_items
  add column updated_at timestamptz not null default now(),
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.object_items.updated_at is
  'Zeitpunkt der letzten Änderung (basiert auf client_updated_at, falls vorhanden).';
comment on column public.object_items.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.object_items.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- inventory_items
alter table public.inventory_items
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.inventory_items.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.inventory_items.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- weekly_default_routes
alter table public.weekly_default_routes
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.weekly_default_routes.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.weekly_default_routes.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- active_tours
alter table public.active_tours
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.active_tours.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.active_tours.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- tour_stops (bekommt zusätzlich updated_at)
alter table public.tour_stops
  add column updated_at timestamptz not null default now(),
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.tour_stops.updated_at is
  'Zeitpunkt der letzten Änderung (basiert auf client_updated_at, falls vorhanden).';
comment on column public.tour_stops.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.tour_stops.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- ------------------------------------------------------------------
-- 3. updated_at-Trigger für object_items & tour_stops
-- ------------------------------------------------------------------
create trigger set_object_items_updated_at
  before update on public.object_items
  for each row execute function public.set_updated_at();

create trigger set_tour_stops_updated_at
  before update on public.tour_stops
  for each row execute function public.set_updated_at();
