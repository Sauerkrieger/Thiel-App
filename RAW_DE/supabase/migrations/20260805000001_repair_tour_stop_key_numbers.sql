-- Reparatur: Schlüssel-Snapshot für Tour-Stopps
--
-- Die Anwendung schreibt beim Tourstart key_number in tour_stops. Diese
-- idempotente Reparaturmigration deckt Datenbanken ab, auf denen die frühere
-- Migration noch nicht ausgeführt wurde, und lädt danach den PostgREST-
-- Schema-Cache neu.

alter table public.tour_stops
  add column if not exists key_number integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tour_stops'::regclass
      and conname = 'tour_stops_key_number_positive'
  ) then
    alter table public.tour_stops
      add constraint tour_stops_key_number_positive
      check (key_number is null or key_number > 0);
  end if;
end
$$;

comment on column public.tour_stops.key_number is
  'Schlüsselnummer, die beim Start der Tour für diesen Stopp eingeplant war.';

notify pgrst, 'reload schema';
