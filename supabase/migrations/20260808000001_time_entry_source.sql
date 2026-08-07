-- =============================================================
-- Thiel Dienstleistungen – Zeiterfassung: Herkunft der Einträge
-- Migration 20260808000001
-- =============================================================
-- `source` unterscheidet normale Stempelungen (Stempeluhr) von
-- nachgereichter Arbeitszeit. Die Admin-Ansicht zeigt daraus:
--   - 'clock'     → „Gestempelt"
--   - 'submitted' + is_approved = true  → „Freigegeben"
--   - 'submitted' + is_approved = false → „Ausstehend"
-- Bestehende Einträge gelten als normal gestempelt.

create type public.time_entry_source as enum ('clock', 'submitted');

alter table public.time_entries
  add column if not exists source public.time_entry_source not null default 'clock';

-- Noch offene (nicht freigegebene) Nachreichungen bleiben im Freigabe-Feed
-- sichtbar; alle übrigen Alt-Einträge gelten als normal gestempelt.
update public.time_entries
  set source = 'submitted'
  where is_approved = false;

comment on column public.time_entries.source is
  'Herkunft des Eintrags: clock = Stempeluhr, submitted = nachgereichte Arbeitszeit.';
