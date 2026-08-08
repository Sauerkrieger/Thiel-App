-- =============================================================
-- Thiel Dienstleistungen – Individuelle Verträge (custom)
-- Migration 20260810000001
--
-- profiles: weekly_target_hours (Wochen-Soll), working_days_per_week,
-- vacation_days_per_year (Jahresurlaub) + Backfill aus Bestandsdaten.
--
-- Resturlaub überall = vacation_days_per_year - vacation_days_used.
-- =============================================================

alter table public.profiles
  add column if not exists weekly_target_hours numeric not null default 40,
  add column if not exists working_days_per_week numeric not null default 5,
  add column if not exists vacation_days_per_year integer not null default 30;

comment on column public.profiles.weekly_target_hours is
  'Wochen-Sollstunden fürs Überstundenkonto (full_time 40, part_time 20, mini_job 10, custom = individuell).';
comment on column public.profiles.working_days_per_week is
  'Geplante Arbeitstage pro Woche (custom; Basis für den Urlaubsanspruch).';
comment on column public.profiles.vacation_days_per_year is
  'Individuelle Jahresurlaubstage. Resturlaub = vacation_days_per_year - vacation_days_used.';

-- Bestandsdaten: Vertrags-Defaults je Vertragsart übernehmen (identisch
-- mit CONTRACT_DEFAULTS in der App) und bestehende Gesamtansprüche (inkl.
-- manueller Korrekturen) als Jahresurlaub übernehmen, damit sich keine
-- Resturlaubs-Anzeige ändert.
update public.profiles
   set weekly_target_hours = case contract_type
         when 'part_time' then 20
         when 'mini_job' then 10
         else 40 end,
       working_days_per_week = case contract_type
         when 'mini_job' then 2
         else 5 end,
       vacation_days_per_year = greatest(coalesce(vacation_days_total, 30), 1);

-- ------------------------------------------------------------------
-- Auth-Trigger: neue Vertragsfelder aus User-Metadaten übernehmen
-- (Fallback je Vertragsart: 40/5/30 – Vollzeit).
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contract_type;
begin
  v_contract := case
    when new.raw_user_meta_data ->> 'contract_type' in
      ('full_time', 'part_time', 'mini_job', 'custom')
      then (new.raw_user_meta_data ->> 'contract_type')::public.contract_type
    else 'full_time'::public.contract_type
  end;

  insert into public.profiles (id, name, role, contract_type,
    weekly_target_hours, working_days_per_week, vacation_days_per_year)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in
        ('driver', 'admin', 'facility_manager', 'substitute')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end,
    v_contract,
    case v_contract when 'part_time' then 20 when 'mini_job' then 10 else 40 end,
    case v_contract when 'mini_job' then 2 else 5 end,
    case v_contract when 'mini_job' then 12 else 30 end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
