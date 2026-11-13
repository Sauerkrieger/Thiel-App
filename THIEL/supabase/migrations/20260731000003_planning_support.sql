-- =============================================================
-- Thiel Dienstleistungen – Schritt 3 (Tourenplanung)
-- Migration 4: RPC save_weekly_defaults
--
-- Erstellt:
--   * public.save_weekly_defaults(p_day_of_week, p_object_ids)
--     Ersetzt die Objektauswahl eines Wochentags transaktional
--     (Löschen + Einfügen in einer Transaktion) und setzt dabei
--     selection_order anhand der übergebenen Reihenfolge.
-- =============================================================

create or replace function public.save_weekly_defaults(
  p_day_of_week integer,
  p_object_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entry record;
begin
  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'Ungültiger Wochentag (0-6 erwartet, % übergeben)', p_day_of_week;
  end if;

  -- Bestehende Auswahl des Wochentags vollständig ersetzen
  delete from public.weekly_default_routes
  where day_of_week = p_day_of_week;

  -- Neu einfügen: Duplikate entfernen, nur existierende Objekte,
  -- selection_order = Position in der übergebenen Liste (0-basiert)
  for entry in
    select distinct on (t.obj_id) t.obj_id, t.ord
    from unnest(p_object_ids) with ordinality as t(obj_id, ord)
    where exists (select 1 from public.objects o where o.id = t.obj_id)
    order by t.obj_id, t.ord
  loop
    insert into public.weekly_default_routes (day_of_week, object_id, selection_order)
    values (p_day_of_week, entry.obj_id, entry.ord - 1);
  end loop;
end;
$$;

-- Für die spätere nutzergebundene Nutzung (RLS) freigeben.
grant execute on function public.save_weekly_defaults(integer, uuid[]) to authenticated;
