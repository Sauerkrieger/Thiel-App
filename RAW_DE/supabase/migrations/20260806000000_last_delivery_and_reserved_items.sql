-- Letzte Belieferung, tatsächlicher Liefer-Snapshot und einmalige Vormerkungen

-- 1) Objekte: Wer hat zuletzt beliefert, wann und was wurde mitgebracht?
alter table public.objects
  add column if not exists last_delivery_at timestamptz,
  add column if not exists last_delivery_driver_name text,
  add column if not exists last_delivery_items jsonb;

comment on column public.objects.last_delivery_at is
  'Zeitpunkt der letzten erfolgreichen Belieferung (Übergang der Tour auf abgeschlossen).';
comment on column public.objects.last_delivery_driver_name is
  'Name des Fahrers, der zuletzt beliefert hat.';
comment on column public.objects.last_delivery_items is
  'JSON-Array mit den tatsächlich gelieferten Items inklusive Menge und Bemerkung.';

-- 2) Items: Einmalig für die nächste Belieferung vormerken.
alter table public.object_items
  add column if not exists is_reserved boolean not null default false;

comment on column public.object_items.is_reserved is
  'Einmalig für die nächste Belieferung vorgemerkt; wird nach erfolgreicher Belieferung automatisch zurückgesetzt.';

-- 3) Tatsächlicher Liefer-Snapshot am Tour-Stopp. next_delivery_items bleibt
--    weiterhin die Vormerkung für die nächste Belieferung.
alter table public.tour_stops
  add column if not exists delivered_items jsonb not null default '[]'::jsonb;

comment on column public.tour_stops.delivered_items is
  'Snapshot der tatsächlich gelieferten Items dieses Stopps, inklusive Menge und Bemerkung.';

-- Vormerkungen nach erfolgreicher Belieferung automatisch verbrauchen. Der
-- Trigger greift auch beim Offline-Sync, der tour_stops direkt synchronisiert.
create or replace function public.reset_reserved_items_after_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_delivered = true and old.is_delivered = false then
    update public.object_items
       set is_reserved = false
     where object_id = new.object_id
       and is_reserved = true;
  end if;

  -- Offline-Sync kann einen bereits abgeschlossenen Tourstatus vor dem
  -- Stopp-Update übertragen. In diesem Fall aktualisieren wir das Objekt
  -- direkt beim gelieferten Stopp.
  if new.is_delivered = true and (
    old.is_delivered = false
    or new.delivered_items is distinct from old.delivered_items
  ) then
    if exists (
      select 1 from public.active_tours t
       where t.id = new.tour_id and t.status = 'completed'
    ) then
      update public.objects o
         set last_delivery_at = now(),
             last_delivery_driver_name = (
               select p.name
                 from public.active_tours t
                 left join public.profiles p on p.id = t.driver_id
                where t.id = new.tour_id
             ),
             last_delivery_items = coalesce(new.delivered_items, '[]'::jsonb)
       where o.id = new.object_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tour_stops_reset_reserved_items on public.tour_stops;
create trigger tour_stops_reset_reserved_items
after update of is_delivered, delivered_items on public.tour_stops
for each row
execute function public.reset_reserved_items_after_delivery();

-- Beim Übergang der Tour auf completed die letzte Belieferung je geliefertem
-- Objekt aktualisieren. Das ist absichtlich DB-seitig, damit es auch bei
-- Offline-Sync und genau einmal pro Tour funktioniert.
create or replace function public.update_last_delivery_on_tour_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stop_row record;
  driver_name_value text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select p.name
      into driver_name_value
      from public.profiles p
     where p.id = new.driver_id;

    for stop_row in
      select ts.object_id, ts.delivered_items
        from public.tour_stops ts
       where ts.tour_id = new.id
         and ts.is_delivered = true
    loop
      update public.objects
         set last_delivery_at = now(),
             last_delivery_driver_name = driver_name_value,
             last_delivery_items = coalesce(stop_row.delivered_items, '[]'::jsonb)
       where id = stop_row.object_id;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists active_tours_update_last_delivery on public.active_tours;
create trigger active_tours_update_last_delivery
after update of status on public.active_tours
for each row
execute function public.update_last_delivery_on_tour_completed();

notify pgrst, 'reload schema';
