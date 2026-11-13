-- =============================================================
-- Thiel Dienstleistungen – Schritt 4 (Routen-Optimierung & Pack-Modus)
-- Migration 5: active_tours & tour_stops
--
-- Erstellt:
--   * Enum public.tour_status ('packing' | 'in_transit' | 'completed')
--   * public.active_tours  (eine geplante Tour pro Tag)
--   * public.tour_stops    (Stopps in optimierter Reihenfolge,
--                           NextDeliveryItems = Extra-Items für die
--                           NÄCHSTE Belieferung, aus dem Pack-Modus)
--   * RLS-Policies
-- =============================================================

create type public.tour_status as enum ('packing', 'in_transit', 'completed');

create table public.active_tours (
  id                      uuid primary key default gen_random_uuid(),
  driver_id               uuid references auth.users (id) on delete set null,
  date                    date not null default current_date,
  status                  public.tour_status not null default 'packing',
  start_time              time,
  total_duration_minutes  integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.tour_stops (
  id                  uuid primary key default gen_random_uuid(),
  tour_id             uuid not null references public.active_tours (id) on delete cascade,
  object_id           uuid not null references public.objects (id) on delete cascade,
  stop_order          integer not null,
  arrival_time        time,
  is_delivered        boolean not null default false,
  next_delivery_items jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  unique (tour_id, stop_order)
);

comment on column public.tour_stops.next_delivery_items is
  'JSON-Liste der wählbaren Items für die nächste Belieferung (Extra-Items, die im Pack-Modus vorgemerkt wurden).';

create index tour_stops_tour_id_idx on public.tour_stops (tour_id);
create index tour_stops_object_id_idx on public.tour_stops (object_id);
create index active_tours_date_idx on public.active_tours (date);

-- ------------------------------------------------------------------
-- updated_at-Trigger
-- ------------------------------------------------------------------
create trigger set_active_tours_updated_at
  before update on public.active_tours
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- RLS (lesen & verwalten: alle authentifizierten Nutzer – analog zu
-- weekly_default_routes, bis die Auth-UI integriert ist)
-- ------------------------------------------------------------------
alter table public.active_tours enable row level security;
alter table public.tour_stops enable row level security;

create policy "active_tours_lesen_authentifiziert"
  on public.active_tours for select
  using (auth.role() = 'authenticated');

create policy "active_tours_verwalten_authentifiziert"
  on public.active_tours for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "tour_stops_lesen_authentifiziert"
  on public.tour_stops for select
  using (auth.role() = 'authenticated');

create policy "tour_stops_verwalten_authentifiziert"
  on public.tour_stops for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
