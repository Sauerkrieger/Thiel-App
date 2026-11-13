-- =============================================================
-- Thiel Dienstleistungen – Strukturierte Items (Menge/Bezeichnung/Bemerkung)
-- =============================================================
-- Erweitert public.object_items:
--   * quantity  (integer, default 1) – Menge, z. B. 60
--   * note      (text, nullable)      – Bemerkung, z. B. "rot, gelb - kein blau"
-- Hebt den Unique-Constraint (object_id, item_name) auf, damit
-- dieselbe Bezeichnung mit unterschiedlicher Menge/Bemerkung
-- mehrfach angelegt werden kann.

alter table public.object_items
  add column quantity integer not null default 1,
  add column note text;

alter table public.object_items
  drop constraint object_items_object_id_item_name_key;

alter table public.object_items
  add constraint object_items_quantity_positive check (quantity > 0);

comment on column public.object_items.quantity is
  'Menge des Items (z. B. 60).';
comment on column public.object_items.note is
  'Bemerkung zum Item (z. B. "rot, gelb - kein blau"). NULL = keine Bemerkung.';
