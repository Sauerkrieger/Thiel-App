-- =============================================================
-- Thiel Dienstleistungen – Zeiterfassung: ArbZG-Pausen & Audit-Log
-- Migration 20260809000000
-- =============================================================
-- 1) Mindestpause nach § 4 ArbZG:
--    - Anwesenheitszeit (clock_out - clock_in) > 6 bis 9 Stunden → min. 30 Min.
--    - Anwesenheitszeit > 9 Stunden → min. 45 Min.
--    Der Trigger ergänzt die erfasste Pause (break_duration_minutes) automatisch
--    auf die Mindestdauer – bei JEDEM Schreibvorgang (Stempeluhr, Sync,
--    Nachreichung, Admin-Korrektur). Netto-Arbeitszeit bleibt
--    (clock_out - clock_in) - break_duration_minutes (workedMinutesOf).
--
-- 2) Revisionssicheres Änderungsprotokoll time_entry_audit_logs:
--    Wird serverseitig geschrieben, wenn ein Admin eine Stempelung im
--    Zeitadmin anpasst, schließt, freigibt oder löscht.

-- ------------------------------------------------------------------
-- 1) Mindestpause (§ 4 ArbZG)
-- ------------------------------------------------------------------
create or replace function public.enforce_min_break()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  presence_minutes integer;
  min_break integer;
begin
  if new.clock_out is not null then
    presence_minutes := floor(extract(epoch from (new.clock_out - new.clock_in)) / 60)::int;
    if presence_minutes > 9 * 60 then
      min_break := 45;
    elsif presence_minutes > 6 * 60 then
      min_break := 30;
    else
      min_break := 0;
    end if;
    if min_break > 0 then
      new.break_duration_minutes := greatest(coalesce(new.break_duration_minutes, 0), min_break);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_min_break on public.time_entries;
create trigger time_entries_min_break
  before insert or update on public.time_entries
  for each row execute function public.enforce_min_break();

-- Backfill: bereits abgeschlossene Einträge auf die Mindestpause anheben.
update public.time_entries
  set break_duration_minutes = greatest(
        break_duration_minutes,
        (case
          when floor(extract(epoch from (clock_out - clock_in)) / 60) > 9 * 60 then 45
          when floor(extract(epoch from (clock_out - clock_in)) / 60) > 6 * 60 then 30
          else 0
        end)::int
      )
where clock_out is not null;

-- ------------------------------------------------------------------
-- 2) Audit-Log
-- ------------------------------------------------------------------
create table public.time_entry_audit_logs (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid references public.time_entries (id) on delete set null,
  changed_by_user_id uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb,
  change_reason text
);

create index time_entry_audit_logs_entry_idx
  on public.time_entry_audit_logs (time_entry_id, changed_at desc);

comment on table public.time_entry_audit_logs is
  'Revisionssicheres Änderungsprotokoll für Zeiteinträge (Admin-Anpassungen, -Freigaben, -Löschungen).';

alter table public.time_entry_audit_logs enable row level security;

-- Lesen nur für Admins; Schreiben ausschließlich serverseitig (Service-Rolle).
create policy "time_entry_audit_logs_admin_read"
  on public.time_entry_audit_logs for select
  using (public.current_user_role() = 'admin');
