-- =============================================================
-- Tourenhistorie: Schlüssel-Snapshot je Tour-Stopp
-- =============================================================
-- Der Schlüssel eines Objekts kann sich später ändern. Deshalb wird die
-- beim Tourstart geplante Schlüsselnummer am Stopp gespeichert, damit die
-- Historie dauerhaft zeigt, welcher Schlüssel für diese Tour vorgesehen war.

alter table public.tour_stops
  add column key_number integer;

alter table public.tour_stops
  add constraint tour_stops_key_number_positive
  check (key_number is null or key_number > 0);

-- Für bereits vorhandene Touren bestmöglicher Snapshot aus der aktuellen
-- Objekt-Stammdatenlage; neue Touren schreiben den Wert beim Tourstart.
update public.tour_stops as stops
set key_number = objects.key_number
from public.objects as objects
where objects.id = stops.object_id;

comment on column public.tour_stops.key_number is
  'Schlüsselnummer, die beim Start der Tour für diesen Stopp eingeplant war.';
