-- =============================================================
-- Thiel Dienstleistungen – Schritt 1 (Basis-Schema)
-- Migration 2: objects & object_items (Objektverwaltung)
--
-- Erstellt:
--   * Enum public.object_category ('objekt' | 'treppenhaus')
--   * Tabelle public.objects
--     - name, address, category
--     - is_pedestrian_zone_until_11 (Fußgängerzone: MUSS vor 11:00 angefahren werden)
--     - opens_at (Öffnungszeit: DARF erst ab dieser Uhrzeit angefahren werden)
--   * Tabelle public.object_items (Standard-Items pro Objekt)
--   * RLS-Policies (lesen: alle authentifiziert; verwalten: admin/facility_manager)
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Kategorie-Enum
-- ------------------------------------------------------------------
create type public.object_category as enum ('objekt', 'treppenhaus');

-- ------------------------------------------------------------------
-- 2. objects
-- ------------------------------------------------------------------
create table public.objects (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  address                   text not null,
  category                  public.object_category not null default 'objekt',
  is_pedestrian_zone_until_11 boolean not null default false,
  opens_at                  time,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on column public.objects.is_pedestrian_zone_until_11 is
  'Fußgängerzone: Objekt MUSS vor 11:00 Uhr angefahren werden (Hard-Restriktion).';
comment on column public.objects.opens_at is
  'Öffnungszeit: Objekt DARF erst ab dieser Uhrzeit angefahren werden (z.B. 11:00). NULL = keine Einschränkung.';

-- ------------------------------------------------------------------
-- 3. object_items (Standard-Items eines Objekts)
--    is_always_required = true  -> fest ausgewählt & ausgegraut (Pack-/Tour-Modus)
-- ------------------------------------------------------------------
create table public.object_items (
  id                 uuid primary key default gen_random_uuid(),
  object_id          uuid not null references public.objects (id) on delete cascade,
  item_name          text not null,
  is_always_required boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (object_id, item_name)
);

create index object_items_object_id_idx on public.object_items (object_id);

-- ------------------------------------------------------------------
-- 4. updated_at-Trigger
-- ------------------------------------------------------------------
create trigger set_objects_updated_at
  before update on public.objects
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 5. RLS
--    Lesen:    alle authentifizierten Nutzer (Fahrer brauchen Zugriff im Tour-Modus)
--    Verwalten: admin & facility_manager (Objektverwaltung, Phase 1)
-- ------------------------------------------------------------------
alter table public.objects enable row level security;
alter table public.object_items enable row level security;

create policy "objects_lesen_authentifiziert"
  on public.objects for select
  using (auth.role() = 'authenticated');

create policy "objects_verwalten_admin_facility"
  on public.objects for all
  using (public.current_user_role() in ('admin', 'facility_manager'))
  with check (public.current_user_role() in ('admin', 'facility_manager'));

create policy "object_items_lesen_authentifiziert"
  on public.object_items for select
  using (auth.role() = 'authenticated');

create policy "object_items_verwalten_admin_facility"
  on public.object_items for all
  using (public.current_user_role() in ('admin', 'facility_manager'))
  with check (public.current_user_role() in ('admin', 'facility_manager'));
