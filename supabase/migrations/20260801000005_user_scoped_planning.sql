-- =============================================================
-- Thiel Dienstleistungen – Nutzerbezogene Tourenplanung
-- =============================================================
-- Änderungen:
--   1. weekly_default_routes.user_id  -> jeder Nutzer hat seine eigene
--      Vorauswahl pro Wochentag („jeder plant seine eigene Tour")
--   2. save_weekly_defaults(p_user_id, p_day_of_week, p_object_ids)
--   3. Index auf active_tours.driver_id für die Tourenhistorie
-- =============================================================

-- ------------------------------------------------------------------
-- 1. weekly_default_routes: user_id (per Nutzer)
-- ------------------------------------------------------------------
alter table public.weekly_default_routes
  add column user_id uuid references auth.users (id) on delete cascade;

-- Bestehende Zeilen dem Seed-Admin zuordnen (frühere globale Defaults).
update public.weekly_default_routes
set user_id = '00000000-0000-0000-0000-000000000001'
where user_id is null;

alter table public.weekly_default_routes
  alter column user_id set not null;

-- Unique-Constraint: pro Nutzer + Wochentag + Objekt
alter table public.weekly_default_routes
  drop constraint weekly_default_routes_day_of_week_object_id_key;

alter table public.weekly_default_routes
  add constraint weekly_default_routes_user_day_object_key
  unique (user_id, day_of_week, object_id);

-- Index für schnellen Zugriff pro Nutzer
drop index if exists weekly_default_routes_day_order_idx;
create index weekly_default_routes_user_day_order_idx
  on public.weekly_default_routes (user_id, day_of_week, selection_order);

-- ------------------------------------------------------------------
-- 2. save_weekly_defaults: nutzerbezogen
-- ------------------------------------------------------------------
create or replace function public.save_weekly_defaults(
  p_user_id uuid,
  p_day_of_week integer,
  p_object_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entry record;
begin
  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'Ungültiger Wochentag (0-6 erwartet, % übergeben)', p_day_of_week;
  end if;

  -- Bestehende Auswahl des Nutzers für den Wochentag vollständig ersetzen
  delete from public.weekly_default_routes
  where user_id = p_user_id and day_of_week = p_day_of_week;

  -- Neu einfügen: Duplikate entfernen, nur existierende Objekte,
  -- selection_order = Position in der übergebenen Liste (0-basiert)
  for entry in
    select distinct on (t.obj_id) t.obj_id, t.ord
    from unnest(p_object_ids) with ordinality as t(obj_id, ord)
    where exists (select 1 from public.objects o where o.id = t.obj_id)
    order by t.obj_id, t.ord
  loop
    insert into public.weekly_default_routes (user_id, day_of_week, object_id, selection_order)
    values (p_user_id, p_day_of_week, entry.obj_id, entry.ord - 1);
  end loop;
end;
$$;

grant execute on function public.save_weekly_defaults(uuid, integer, uuid[]) to authenticated;

-- ------------------------------------------------------------------
-- 3. Index für die Tourenhistorie (Filter auf driver_id)
-- ------------------------------------------------------------------
create index active_tours_driver_id_idx on public.active_tours (driver_id);
