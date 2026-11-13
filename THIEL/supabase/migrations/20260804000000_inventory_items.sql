-- =============================================================
-- Thiel Dienstleistungen – Inventar (Item-Katalog, Admin)
-- =============================================================
-- Neuer Reiter „Inventar“ (nur Admin): alle Items namentlich
-- gelistet, mit Such- & Sortierfunktion, Anmerkungen je Item und
-- der Möglichkeit, neue Items anzulegen.
--
-- Tabelle public.inventory_items:
--   * name  (text, Pflicht) – Bezeichnung des Items, z. B. "Micromops"
--   * note  (text, nullable) – Anmerkung, z. B. "grün, blau, gelb, rot"
--
-- RLS: Lesen für alle authentifizierten Nutzer, verwalten (anlegen/
-- bearbeiten/löschen) nur für Admins.
-- =============================================================

create table public.inventory_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.inventory_items.name is
  'Bezeichnung des Items (z. B. "Micromops").';
comment on column public.inventory_items.note is
  'Anmerkung zum Item (z. B. "grün, blau, gelb, rot"). NULL = keine Anmerkung.';

create index inventory_items_name_idx on public.inventory_items (lower(name));

-- updated_at-Trigger (set_updated_at stammt aus Migration 1)
create trigger set_inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- RLS: Lesen alle authentifiziert; verwalten nur Admin
-- ------------------------------------------------------------------
alter table public.inventory_items enable row level security;

create policy "inventory_items_lesen_authentifiziert"
  on public.inventory_items for select
  using (auth.role() = 'authenticated');

create policy "inventory_items_verwalten_admin"
  on public.inventory_items for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ------------------------------------------------------------------
-- Seed: initiale Item-Liste (Bemerkungen als Anmerkungen)
-- ------------------------------------------------------------------
insert into public.inventory_items (name, note) values
  ('Franzenmop', null),
  ('M-Power', 'grün, blau, gelb, rot'),
  ('Polierleinen', null),
  ('Tana SR13', 'bzw. Tana SR13 1L'),
  ('Micromops', null),
  ('Micromops', 'mit Streifen'),
  ('Micromops', 'Klein'),
  ('Micromops', 'Grün'),
  ('Waffeltuch', null),
  ('Schwamm', null),
  ('Tasonil', 'Tana Tasonil 1L'),
  ('Sr13', null),
  ('Az70', null),
  ('Lamitan', null),
  ('Vioclean', null),
  ('Müllbeutel', '30l, 60l'),
  ('Müllsäcke', null),
  ('Staubsaugerbeutel', null),
  ('Glasreiniger', null),
  ('Handschuhe', 'S,M,L,XL'),
  ('Tana Innomat 10L', null);
