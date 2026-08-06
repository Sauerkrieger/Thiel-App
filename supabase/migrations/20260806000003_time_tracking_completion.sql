-- Ergänzungen für Phase 2–4 der Zeiterfassung.
-- Diese Migration ist bewusst unabhängig von der initialen Enum-/Tabellenmigration.

alter table public.time_off_requests
  add column if not exists employee_note text;

comment on column public.time_off_requests.employee_note is
  'Optionale Notiz des Mitarbeiters zum Abwesenheitsantrag.';

-- Urlaubskonto-Buchung: Wird ein Urlaubsantrag genehmigt, werden die Tage auf
-- profiles.vacation_days_used verbucht; bei Ablehnung/Widerruf wieder abgezogen.
create or replace function public.apply_time_off_approval_accounting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vacation_delta integer := 0;
  request_days integer;
begin
  if new.type = 'vacation' then
    request_days := (new.end_date - new.start_date) + 1;
    if new.status = 'approved' and coalesce(old.status, 'pending') <> 'approved' then
      vacation_delta := request_days;
    elsif new.status <> 'approved' and old.status = 'approved' then
      vacation_delta := -request_days;
    end if;
  end if;

  if vacation_delta <> 0 then
    update public.profiles
       set vacation_days_used = greatest(0, vacation_days_used + vacation_delta)
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_time_off_approval_accounting on public.time_off_requests;
create trigger apply_time_off_approval_accounting
after update of status on public.time_off_requests
for each row execute function public.apply_time_off_approval_accounting();

comment on function public.apply_time_off_approval_accounting() is
  'Bucht Urlaubstage bei Statuswechsel. Hinweis: Zeitraumänderungen an bereits genehmigten Anträgen werden nicht automatisch nachgebucht (nur Statuswechsel).';

-- Einmalige Korrektur für bereits vor dieser Migration genehmigte Urlaubsanträge.
update public.profiles p
set vacation_days_used = coalesce(approved.days_used, 0)
from (
  select user_id, sum((end_date - start_date) + 1)::integer as days_used
  from public.time_off_requests
  where type = 'vacation' and status = 'approved'
  group by user_id
) approved
where p.id = approved.user_id;
