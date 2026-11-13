-- =============================================================
-- Thiel Dienstleistungen – Reinigungskraft & Vertragsart
-- Migration 20260808000000
--
-- 1. Die Rolle „Reiniger" (cleaner) entfällt: Bestehende Reiniger
--    werden Reinigungskräfte (facility_manager, Funktionsweise
--    unverändert). Der Enum-Wert wird entfernt, sofern die
--    Datenbank-Version das unterstützt (PostgreSQL 16+).
-- 2. profiles.contract_type: Vollzeit (40 h/Woche), Teilzeit
--    (20 h/Woche), Minijob (10 h/Woche) – Grundlage für den
--    automatischen Soll/Ist-Vergleich im Überstundenkonto.
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Reiniger -> Reinigungskraft (facility_manager)
-- ------------------------------------------------------------------
update public.profiles
   set role = 'facility_manager'
 where role = 'cleaner';

-- Enum-Wert entfernen (nur PostgreSQL >= 16 kann Enum-Werte droppen;
-- ältere Versionen lassen den Wert ungenutzt stehen – harmlos, da die
-- App ihn nicht mehr verwendet). Fehler werden bewusst geschluckt,
-- damit die Migration auch in Transaktionsblöcken durchläuft.
do $$
begin
  if current_setting('server_version_num')::int >= 160000 then
    begin
      execute 'alter type public.user_role drop value if exists ''cleaner''';
    exception when others then
      raise notice 'Enum-Wert "cleaner" konnte nicht entfernt werden: %', sqlerrm;
    end;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 2. Vertragsart (Soll-Arbeitszeit je Woche)
-- ------------------------------------------------------------------
create type public.contract_type as enum (
  'full_time',
  'part_time',
  'mini_job'
);

alter table public.profiles
  add column if not exists contract_type public.contract_type not null default 'full_time';

comment on column public.profiles.contract_type is
  'Vertragsart: full_time (40 h/Woche), part_time (20 h/Woche), mini_job (10 h/Woche). Steuert den automatischen Soll/Ist-Vergleich im Überstundenkonto.';

-- ------------------------------------------------------------------
-- 3. Auth-Trigger ohne „cleaner" aktualisieren (der Enum-Wert darf
--    nicht mehr gesetzt werden) + Vertragsart aus User-Metadaten
--    übernehmen (Fallback: Vollzeit).
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role, contract_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in
        ('driver', 'admin', 'facility_manager', 'substitute')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end,
    case
      when new.raw_user_meta_data ->> 'contract_type' in
        ('full_time', 'part_time', 'mini_job')
        then (new.raw_user_meta_data ->> 'contract_type')::public.contract_type
      else 'full_time'::public.contract_type
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
