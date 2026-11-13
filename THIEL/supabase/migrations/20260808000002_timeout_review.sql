-- =============================================================
-- Thiel Dienstleistungen – Zeiterfassung: Auto-Timeout & Prüfbedarf
-- Migration 20260808000002
-- =============================================================
-- Vergessene Ausstempelungen werden automatisch als „prüfbedürftig"
-- markiert, sobald eine offene Stempelung (clock_out IS NULL)
--   - die 12-Stunden-Marke überschreitet ODER
--   - Mitternacht (00:00 Uhr, Europa/Berlin) erreicht.
-- Solche Einträge erhalten requires_review = true und is_approved = false,
-- erscheinen im Freigabe-Feed der Verwaltung und fließen solange NICHT in
-- Wochen-/Monatssummen oder das Überstundenkonto ein.
--
-- Der Trigger markiert bei jedem Schreibvorgang; die Funktion
-- flag_overdue_time_entries() fängt offene Einträge ab, die „im Stillen"
-- überfällig geworden sind (wird bei jedem Lese-/Schreib-Zugriff aufgerufen).

alter table public.time_entries
  add column if not exists requires_review boolean not null default false;

comment on column public.time_entries.requires_review is
  'true = Eintrag ist prüfbedürftig (vergessene Ausstempelung / wartet auf Prüfung).';

-- ------------------------------------------------------------------
-- Trigger: Flags bei Schreibvorgängen setzen/zurücksetzen
-- ------------------------------------------------------------------
create or replace function public.set_time_entry_review_flag()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  overdue boolean;
begin
  -- Überfällig = offen UND (12 h überschritten ODER Mitternacht erreicht).
  overdue := new.clock_out is null
    and (
      now() - new.clock_in >= interval '12 hours'
      or new.clock_in < (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
    );

  if overdue then
    new.is_approved := false;
    new.requires_review := true;
  elsif new.clock_out is not null and new.is_approved then
    -- Abgeschlossen + freigegeben (normales Ausstempeln oder Admin-Freigabe):
    -- Prüfbedarf ist gelöst.
    new.requires_review := false;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_review_flag on public.time_entries;
create trigger time_entries_review_flag
  before insert or update on public.time_entries
  for each row execute function public.set_time_entry_review_flag();

-- ------------------------------------------------------------------
-- Housekeeping: im Stillen überfällig gewordene Einträge nachträglich markieren
-- ------------------------------------------------------------------
create or replace function public.flag_overdue_time_entries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  flagged integer;
begin
  update public.time_entries
    set requires_review = true,
        is_approved = false
  where clock_out is null
    and not requires_review
    and (
      now() - clock_in >= interval '12 hours'
      or clock_in < (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
    );
  get diagnostics flagged = row_count;
  return flagged;
end;
$$;

-- ------------------------------------------------------------------
-- Backfill: bereits überfällige offene Einträge aus Altbestand markieren
-- ------------------------------------------------------------------
update public.time_entries
  set requires_review = true,
      is_approved = false
where clock_out is null
  and (
    now() - clock_in >= interval '12 hours'
    or clock_in < (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
  );
