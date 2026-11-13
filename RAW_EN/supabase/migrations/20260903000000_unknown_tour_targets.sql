-- Temporäre, nur für eine einzelne Tour gültige Ziele.
-- Sie werden beim Start zusammen mit dem Tour-Stopp gespeichert und erscheinen
-- danach nur in der Tour bzw. deren Historie.
alter table public.tour_stops
  alter column object_id drop not null;

alter table public.tour_stops
  add column if not exists is_unknown boolean not null default false,
  add column if not exists unknown_target_id text,
  add column if not exists unknown_name text,
  add column if not exists unknown_address text,
  add column if not exists unknown_latitude double precision,
  add column if not exists unknown_longitude double precision;

comment on column public.tour_stops.is_unknown is
  'Temporäres Ziel ohne Eintrag in public.objects.';
comment on column public.tour_stops.unknown_target_id is
  'Client-ID des temporären Ziels, nur innerhalb der Tour relevant.';
