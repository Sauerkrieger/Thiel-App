-- =============================================================
-- Thiel Dienstleistungen – Objektbetreuer (facility_manager)
-- Migration: Objekt-Zuweisungen + RLS-Anpassung
--
-- 1. public.object_assignments  (m:n user <-> object)
-- 2. RLS: Objektbetreuer sehen NUR ihre zugewiesenen Objekte
--    und deren Items; Schreibzugriff bleibt Admins vorbehalten.
--    Springer (substitute) & alle anderen Rollen bleiben unberührt.
-- =============================================================

-- ------------------------------------------------------------------
-- 1. object_assignments (m:n)
-- ------------------------------------------------------------------
create table public.object_assignments (
  user_id    uuid not null references auth.users (id) on delete cascade,
  object_id  uuid not null references public.objects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, object_id)
);

create index object_assignments_object_id_idx
  on public.object_assignments (object_id);

comment on table public.object_assignments is
  'Zuweisung von Objektbetreuern (facility_manager) zu Lieferobjekten.';

-- ------------------------------------------------------------------
-- 2. RLS auf object_assignments
--    Admins verwalten alle Zuweisungen; Objektbetreuer dürfen die
--    eigene Zuweisung lesen (Anzeige der zugewiesenen Objekte).
-- ------------------------------------------------------------------
alter table public.object_assignments enable row level security;

create policy "object_assignments_admin_all"
  on public.object_assignments for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "object_assignments_own_read"
  on public.object_assignments for select
  to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 3. objects: Rollenbewusstes Lesen + Admin-Schreiben
--    - Lesen: alle Rollen außer facility_manager; Objektbetreuer nur
--      ihre zugewiesenen Objekte
--    - Schreiben: nur Admins (Objektbetreuer sind reine Betrachter)
-- ------------------------------------------------------------------
drop policy if exists "objects_lesen_authentifiziert" on public.objects;
drop policy if exists "objects_verwalten_admin_facility" on public.objects;
drop policy if exists "objects_authenticated_all" on public.objects;

create policy "objects_lesen_rollenbewusst"
  on public.objects for select
  to authenticated
  using (
    public.current_user_role() <> 'facility_manager'
    or exists (
      select 1 from public.object_assignments a
      where a.user_id = auth.uid()
        and a.object_id = public.objects.id
    )
  );

create policy "objects_verwalten_admin"
  on public.objects for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ------------------------------------------------------------------
-- 4. object_items: Analog – Lesen rollenbewusst, Schreiben nur Admin
-- ------------------------------------------------------------------
drop policy if exists "object_items_lesen_authentifiziert" on public.object_items;
drop policy if exists "object_items_verwalten_admin_facility" on public.object_items;
drop policy if exists "object_items_authenticated_all" on public.object_items;

create policy "object_items_lesen_rollenbewusst"
  on public.object_items for select
  to authenticated
  using (
    public.current_user_role() <> 'facility_manager'
    or exists (
      select 1 from public.object_assignments a
      where a.user_id = auth.uid()
        and a.object_id = public.object_items.object_id
    )
  );

create policy "object_items_verwalten_admin"
  on public.object_items for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
