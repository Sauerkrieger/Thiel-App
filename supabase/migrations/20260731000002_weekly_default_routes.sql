-- =============================================================
-- Thiel Dienstleistungen – Schritt 1 (Basis-Schema)
-- Migration 3: weekly_default_routes (Wochentags-Defaults)
--
-- Erstellt:
--   * Tabelle public.weekly_default_routes
--     - day_of_week  (0-6, 0 = Sonntag ... 6 = Samstag, Postgres/JS-Konvention)
--     - object_id    (FK -> objects)
--     - selection_order (Reihenfolge der Objektauswahl im Tourenplaner)
--   * RLS-Policies (lesen & verwalten: alle authentifizierten Nutzer,
--     da Fahrer beim Tourenplanen ihre Auswahl als Default speichern)
-- =============================================================

-- ------------------------------------------------------------------
-- 1. weekly_default_routes
--    Eine Zeile = "Objekt X ist am Wochentag Y Teil der Standard-Route"
-- ------------------------------------------------------------------
create table public.weekly_default_routes (
  id              uuid primary key default gen_random_uuid(),
  day_of_week     smallint not null check (day_of_week between 0 and 6),
  object_id       uuid not null references public.objects (id) on delete cascade,
  selection_order integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (day_of_week, object_id)
);

comment on column public.weekly_default_routes.day_of_week is
  'Wochentag 0-6 nach Postgres/JS-Konvention: 0 = Sonntag, 1 = Montag, ..., 6 = Samstag.';

create index weekly_default_routes_day_order_idx
  on public.weekly_default_routes (day_of_week, selection_order);

-- ------------------------------------------------------------------
-- 2. updated_at-Trigger
-- ------------------------------------------------------------------
create trigger set_weekly_default_routes_updated_at
  before update on public.weekly_default_routes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 3. RLS
--    Lesen & Verwalten: alle authentifizierten Nutzer (Phase 2:
--    "Bei Aufruf der Tourenplanung am Montag wird der vergangene
--     Montag als Vorauswahl geladen" -> Fahrer speichert Defaults).
-- ------------------------------------------------------------------
alter table public.weekly_default_routes enable row level security;

create policy "weekly_default_routes_lesen_authentifiziert"
  on public.weekly_default_routes for select
  using (auth.role() = 'authenticated');

create policy "weekly_default_routes_verwalten_authentifiziert"
  on public.weekly_default_routes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
