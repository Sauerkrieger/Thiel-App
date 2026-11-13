-- =============================================================
-- Thiel Dienstleistungen – Urlaubstage nach Arbeitstagen
-- Migration 20260831000000
-- =============================================================
-- Urlaub wird nur für genehmigte Urlaubsanträge des aktuellen Kalenderjahres
-- verbucht. Gezählt werden Montag bis Freitag; bei Teilzeit/Minijob wird die
-- Zahl anhand von working_days_per_week proportional auf die hinterlegten
-- Arbeitstage umgerechnet. Konkrete Wochentage sind im Profil nicht hinterlegt.

create or replace function public.calculate_time_off_workdays(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with profile_days as (
    select greatest(coalesce(working_days_per_week, 5), 1) as days_per_week
    from public.profiles
    where id = p_user_id
  ),
  weekdays as (
    select count(*)::numeric as weekday_count
    from generate_series(p_start_date, p_end_date, interval '1 day') as dates(day)
    where extract(isodow from dates.day) between 1 and 5
  )
  select case
    when p_start_date > p_end_date then 0
    else ceil(
      weekdays.weekday_count * coalesce(profile_days.days_per_week, 5) / 5
    )::integer
  end
  from weekdays
  cross join profile_days
$$;

comment on function public.calculate_time_off_workdays(uuid, date, date) is
  'Berechnet Urlaubstage als Montag-Freitag, proportional zu den geplanten Arbeitstagen pro Woche.';

create or replace function public.recalculate_vacation_days_used(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year_start date := make_date(extract(year from current_date)::integer, 1, 1);
  current_year_end date := make_date(extract(year from current_date)::integer, 12, 31);
  calculated_days integer;
begin
  select coalesce(sum(public.calculate_time_off_workdays(
    r.user_id,
    greatest(r.start_date, current_year_start),
    least(r.end_date, current_year_end)
  )), 0)::integer
    into calculated_days
    from public.time_off_requests r
   where r.user_id = p_user_id
     and r.type = 'vacation'
     and r.status = 'approved'
     and r.end_date >= current_year_start
     and r.start_date <= current_year_end;

  update public.profiles
     set vacation_days_used = greatest(calculated_days, 0)
   where id = p_user_id;
end;
$$;

comment on function public.recalculate_vacation_days_used(uuid) is
  'Synchronisiert die genutzten Urlaubstage für das aktuelle Kalenderjahr aus genehmigten Urlaubsanträgen.';

-- Die beiden historischen Trigger würden zusätzlich Kalendertage buchen und
-- müssen daher vor dem neuen zentralen Recalculate-Trigger entfernt werden.
drop trigger if exists apply_time_off_approval_accounting on public.time_off_requests;
drop trigger if exists apply_time_off_insert_accounting on public.time_off_requests;

create or replace function public.sync_vacation_days_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_vacation_days_used(old.user_id);
    return old;
  end if;

  perform public.recalculate_vacation_days_used(new.user_id);
  if tg_op = 'UPDATE' and old.user_id <> new.user_id then
    perform public.recalculate_vacation_days_used(old.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_vacation_days_used on public.time_off_requests;
create trigger sync_vacation_days_used
after insert or update or delete on public.time_off_requests
for each row execute function public.sync_vacation_days_used();

-- Ändert sich die vertragliche Zahl der Arbeitstage, muss die Nutzung der
-- genehmigten Anträge ebenfalls neu bewertet werden.
create or replace function public.sync_vacation_days_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_vacation_days_used(new.id);
  return new;
end;
$$;

drop trigger if exists sync_vacation_days_after_profile_change on public.profiles;
create trigger sync_vacation_days_after_profile_change
after update of working_days_per_week on public.profiles
for each row
when (old.working_days_per_week is distinct from new.working_days_per_week)
execute function public.sync_vacation_days_after_profile_change();

-- Bestehende Konten einmalig aus den genehmigten Anträgen neu aufbauen. Dabei
-- werden auch abgelehnte/stornierte Anträge und Wochenenden korrekt entfernt.
do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform public.recalculate_vacation_days_used(profile_row.id);
  end loop;
end;
$$;
