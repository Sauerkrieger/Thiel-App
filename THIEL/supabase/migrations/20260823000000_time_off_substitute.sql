-- =============================================================
-- Thiel Dienstleistungen – Abwesenheitskalender: Vertretung
-- Migration 20260823000000
-- =============================================================
-- Vertretung ist kein eigener Abwesenheitstyp. Sie wird als zusätzliches
-- Kalenderereignis auf dem ausgewählten Mitarbeiter dargestellt.

alter table public.time_off_requests
  add column if not exists substitute_id uuid references auth.users (id) on delete set null;

alter table public.time_off_requests
  drop constraint if exists time_off_requests_substitute_not_requester;

alter table public.time_off_requests
  add constraint time_off_requests_substitute_not_requester
  check (substitute_id is null or substitute_id <> user_id);

create index if not exists time_off_requests_substitute_dates_idx
  on public.time_off_requests (substitute_id, start_date, end_date)
  where substitute_id is not null;

comment on column public.time_off_requests.substitute_id is
  'Optionaler Mitarbeiter, der die Vertretung für diesen Abwesenheitszeitraum übernimmt.';

-- Admin-Nachträge können direkt als genehmigt angelegt werden. Der bestehende
-- Statuswechsel-Trigger greift bei INSERT nicht, daher wird die Buchung hier
-- einmalig für diesen Schreibpfad ergänzt.
create or replace function public.apply_time_off_insert_accounting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'vacation' and new.status = 'approved' then
    update public.profiles
       set vacation_days_used = greatest(0, vacation_days_used + ((new.end_date - new.start_date) + 1))
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_time_off_insert_accounting on public.time_off_requests;
create trigger apply_time_off_insert_accounting
after insert on public.time_off_requests
for each row execute function public.apply_time_off_insert_accounting();
