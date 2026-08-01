-- =============================================================
-- Thiel Dienstleistungen – Schlüssel-Nummern, Item-Fotos, Storage
-- =============================================================
-- 1. public.objects.key_number   (optional, integer > 0)
-- 2. public.object_items.photo_path (optional, Storage-Pfad)
-- 3. Storage-Bucket "item-photos" (public) + Policies

-- ------------------------------------------------------------------
-- 1. key_number auf objects
-- ------------------------------------------------------------------
alter table public.objects
  add column key_number integer;

alter table public.objects
  add constraint objects_key_number_positive check (key_number is null or key_number > 0);

comment on column public.objects.key_number is
  'Schlüssel-Nummer des Objekts (z. B. 5). NULL = keine Schlüsselnummer hinterlegt.';

-- ------------------------------------------------------------------
-- 2. photo_path auf object_items (Foto des Items im Storage-Bucket)
-- ------------------------------------------------------------------
alter table public.object_items
  add column photo_path text;

comment on column public.object_items.photo_path is
  'Pfad des Item-Fotos im Storage-Bucket "item-photos" (z. B. items/<uuid>.jpg). NULL = kein Foto.';

-- ------------------------------------------------------------------
-- 3. Storage-Bucket "item-photos" (public) + Policies
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

create policy "item_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'item-photos');

create policy "item_photos_insert_authenticated"
  on storage.objects for insert
  with check (bucket_id = 'item-photos');

create policy "item_photos_update_authenticated"
  on storage.objects for update
  using (bucket_id = 'item-photos')
  with check (bucket_id = 'item-photos');

create policy "item_photos_delete_authenticated"
  on storage.objects for delete
  using (bucket_id = 'item-photos');
