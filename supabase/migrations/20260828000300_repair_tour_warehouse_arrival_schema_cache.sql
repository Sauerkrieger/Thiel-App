-- Reparatur für bestehende Installationen, bei denen die ursprüngliche
-- warehouse_arrival-Migration bereits als ausgeführt markiert wurde oder
-- PostgREST die neue Spalte noch nicht im Schema-Cache kennt.
alter table public.active_tours
  add column if not exists warehouse_arrival time;

comment on column public.active_tours.warehouse_arrival is
  'Geplante Ankunftszeit zurück im Lager (HH:MM), beim Tourstart aus der Routenberechnung übernommen.';

-- Supabase/PostgREST übernimmt neue Spalten sonst ggf. erst verzögert.
select pg_notify('pgrst', 'reload schema');
