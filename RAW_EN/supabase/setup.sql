-- =============================================================
-- Firmen-App – Datenbank-Setup
-- Alle Migrationen aus supabase/migrations, in Dateinamen-Reihenfolge.
--
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen
-- (alternativ: `supabase db push` mit verknüpftem Projekt).
-- Die Datei ist NICHT dafür gedacht, mehrfach ausgeführt zu werden.
--
-- Enthalten u.a. Schema, Enums, Trigger, RLS-Policies und der
-- Seed-Admin (Benutzername: Admin, Passwort: bitte-aendern!).
-- =============================================================


-- =============================================================
-- 20260731000000_roles_and_profiles.sql
-- =============================================================
-- =============================================================
-- Schritt 1 (Basis-Schema)
-- Migration 1: Rollen & Benutzerprofile (mandanten-/rollenfähig)
--
-- Erstellt:
--   * Enum public.user_role ('driver' | 'admin' | 'facility_manager')
--   * Tabelle public.profiles (1:1 zu auth.users, inkl. Name & Rolle)
--   * Trigger on_auth_user_created (Profil wird bei Registrierung angelegt)
--   * Trigger-Funktion public.set_updated_at() (wiederverwendbar)
--   * RLS-Helfer public.current_user_role()
--   * RLS-Policies für profiles
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Rollen-Enum
-- ------------------------------------------------------------------
create type public.user_role as enum ('driver', 'admin', 'facility_manager');

-- ------------------------------------------------------------------
-- 2. profiles-Tabelle (1:1 zu auth.users)
--    Die Rolle liegt direkt am Profil und steuert alle RLS-Policies.
-- ------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       public.user_role not null default 'driver',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 3. Profil automatisch bei neuer Auth-Registrierung anlegen
--    Name & Rolle kommen aus raw_user_meta_data (admin legt Nutzer an).
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in ('driver', 'admin', 'facility_manager')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- 4. Trigger-Funktion für updated_at (von allen Tabellen genutzt)
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- 5. RLS-Helfer: aktuelle Rolle des angemeldeten Nutzers
--    (security definer, damit die Funktion selbst RLS-frei läuft)
-- ------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ------------------------------------------------------------------
-- 6. RLS: profiles
--    * Jeder Nutzer sieht nur sein eigenes Profil.
--    * Admins verwalten alle Profile (Anlegen weiterer Fahrer etc.).
-- ------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_lesen_eigenes_profil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_admin_verwaltet_alle"
  on public.profiles for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ------------------------------------------------------------------
-- 7. updated_at-Trigger für profiles
-- ------------------------------------------------------------------
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- =============================================================
-- 20260731000001_objects_and_object_items.sql
-- =============================================================
-- =============================================================
-- Schritt 1 (Basis-Schema)
-- Migration 2: objects & object_items (Objektverwaltung)
--
-- Erstellt:
--   * Enum public.object_category ('objekt' | 'treppenhaus')
--   * Tabelle public.objects
--     - name, address, category
--     - is_pedestrian_zone_until_11 (Fußgängerzone: MUSS vor 11:00 angefahren werden)
--     - opens_at (Öffnungszeit: DARF erst ab dieser Uhrzeit angefahren werden)
--   * Tabelle public.object_items (Standard-Items pro Objekt)
--   * RLS-Policies (lesen: alle authentifiziert; verwalten: admin/facility_manager)
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Kategorie-Enum
-- ------------------------------------------------------------------
create type public.object_category as enum ('objekt', 'treppenhaus');

-- ------------------------------------------------------------------
-- 2. objects
-- ------------------------------------------------------------------
create table public.objects (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  address                   text not null,
  category                  public.object_category not null default 'objekt',
  is_pedestrian_zone_until_11 boolean not null default false,
  opens_at                  time,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on column public.objects.is_pedestrian_zone_until_11 is
  'Fußgängerzone: Objekt MUSS vor 11:00 Uhr angefahren werden (Hard-Restriktion).';
comment on column public.objects.opens_at is
  'Öffnungszeit: Objekt DARF erst ab dieser Uhrzeit angefahren werden (z.B. 11:00). NULL = keine Einschränkung.';

-- ------------------------------------------------------------------
-- 3. object_items (Standard-Items eines Objekts)
--    is_always_required = true  -> fest ausgewählt & ausgegraut (Pack-/Tour-Modus)
-- ------------------------------------------------------------------
create table public.object_items (
  id                 uuid primary key default gen_random_uuid(),
  object_id          uuid not null references public.objects (id) on delete cascade,
  item_name          text not null,
  is_always_required boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (object_id, item_name)
);

create index object_items_object_id_idx on public.object_items (object_id);

-- ------------------------------------------------------------------
-- 4. updated_at-Trigger
-- ------------------------------------------------------------------
create trigger set_objects_updated_at
  before update on public.objects
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 5. RLS
--    Lesen:    alle authentifizierten Nutzer (Fahrer brauchen Zugriff im Tour-Modus)
--    Verwalten: admin & facility_manager (Objektverwaltung, Phase 1)
-- ------------------------------------------------------------------
alter table public.objects enable row level security;
alter table public.object_items enable row level security;

create policy "objects_lesen_authentifiziert"
  on public.objects for select
  using (auth.role() = 'authenticated');

create policy "objects_verwalten_admin_facility"
  on public.objects for all
  using (public.current_user_role() in ('admin', 'facility_manager'))
  with check (public.current_user_role() in ('admin', 'facility_manager'));

create policy "object_items_lesen_authentifiziert"
  on public.object_items for select
  using (auth.role() = 'authenticated');

create policy "object_items_verwalten_admin_facility"
  on public.object_items for all
  using (public.current_user_role() in ('admin', 'facility_manager'))
  with check (public.current_user_role() in ('admin', 'facility_manager'));


-- =============================================================
-- 20260731000002_weekly_default_routes.sql
-- =============================================================
-- =============================================================
-- Schritt 1 (Basis-Schema)
-- Migration 3: weekly_default_routes (Wochentags-Defaults)
--
-- Erstellt:
--   * Tabelle public.weekly_default_routes
--     - day_of_week  (0-6, 0 = Sonntag ... 6 = Samstag, Postgres/JS-Konvention)
--     - object_id    (FK -> objects)
--     - selection_order (Reihenfolge der Objektauswahl im Tourenplaner)
--   * RLS-Policies (lesen & verwalten: alle authentifizierten Nutzer,
--     da Fahrer beim Tourenplanen ihre Auswahl als Default speichern)
-- =============================================================

-- ------------------------------------------------------------------
-- 1. weekly_default_routes
--    Eine Zeile = "Objekt X ist am Wochentag Y Teil der Standard-Route"
-- ------------------------------------------------------------------
create table public.weekly_default_routes (
  id              uuid primary key default gen_random_uuid(),
  day_of_week     smallint not null check (day_of_week between 0 and 6),
  object_id       uuid not null references public.objects (id) on delete cascade,
  selection_order integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (day_of_week, object_id)
);

comment on column public.weekly_default_routes.day_of_week is
  'Wochentag 0-6 nach Postgres/JS-Konvention: 0 = Sonntag, 1 = Montag, ..., 6 = Samstag.';

create index weekly_default_routes_day_order_idx
  on public.weekly_default_routes (day_of_week, selection_order);

-- ------------------------------------------------------------------
-- 2. updated_at-Trigger
-- ------------------------------------------------------------------
create trigger set_weekly_default_routes_updated_at
  before update on public.weekly_default_routes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 3. RLS
--    Lesen & Verwalten: alle authentifizierten Nutzer (Phase 2:
--    "Bei Aufruf der Tourenplanung am Montag wird der vergangene
--     Montag als Vorauswahl geladen" -> Fahrer speichert Defaults).
-- ------------------------------------------------------------------
alter table public.weekly_default_routes enable row level security;

create policy "weekly_default_routes_lesen_authentifiziert"
  on public.weekly_default_routes for select
  using (auth.role() = 'authenticated');

create policy "weekly_default_routes_verwalten_authentifiziert"
  on public.weekly_default_routes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');


-- =============================================================
-- 20260731000003_planning_support.sql
-- =============================================================
-- =============================================================
-- Schritt 3 (Tourenplanung)
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


-- =============================================================
-- 20260731000004_tours_and_packing.sql
-- =============================================================
-- =============================================================
-- Schritt 4 (Routen-Optimierung & Pack-Modus)
-- Migration 5: active_tours & tour_stops
--
-- Erstellt:
--   * Enum public.tour_status ('packing' | 'in_transit' | 'completed')
--   * public.active_tours  (eine geplante Tour pro Tag)
--   * public.tour_stops    (Stopps in optimierter Reihenfolge,
--                           NextDeliveryItems = Extra-Items für die
--                           NÄCHSTE Belieferung, aus dem Pack-Modus)
--   * RLS-Policies
-- =============================================================

create type public.tour_status as enum ('packing', 'in_transit', 'completed');

create table public.active_tours (
  id                      uuid primary key default gen_random_uuid(),
  driver_id               uuid references auth.users (id) on delete set null,
  date                    date not null default current_date,
  status                  public.tour_status not null default 'packing',
  start_time              time,
  total_duration_minutes  integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.tour_stops (
  id                  uuid primary key default gen_random_uuid(),
  tour_id             uuid not null references public.active_tours (id) on delete cascade,
  object_id           uuid not null references public.objects (id) on delete cascade,
  stop_order          integer not null,
  arrival_time        time,
  is_delivered        boolean not null default false,
  next_delivery_items jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  unique (tour_id, stop_order)
);

comment on column public.tour_stops.next_delivery_items is
  'JSON-Liste der wählbaren Items für die nächste Belieferung (Extra-Items, die im Pack-Modus vorgemerkt wurden).';

create index tour_stops_tour_id_idx on public.tour_stops (tour_id);
create index tour_stops_object_id_idx on public.tour_stops (object_id);
create index active_tours_date_idx on public.active_tours (date);

-- ------------------------------------------------------------------
-- updated_at-Trigger
-- ------------------------------------------------------------------
create trigger set_active_tours_updated_at
  before update on public.active_tours
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- RLS (lesen & verwalten: alle authentifizierten Nutzer – analog zu
-- weekly_default_routes, bis die Auth-UI integriert ist)
-- ------------------------------------------------------------------
alter table public.active_tours enable row level security;
alter table public.tour_stops enable row level security;

create policy "active_tours_lesen_authentifiziert"
  on public.active_tours for select
  using (auth.role() = 'authenticated');

create policy "active_tours_verwalten_authentifiziert"
  on public.active_tours for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "tour_stops_lesen_authentifiziert"
  on public.tour_stops for select
  using (auth.role() = 'authenticated');

create policy "tour_stops_verwalten_authentifiziert"
  on public.tour_stops for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');


-- =============================================================
-- 20260801000000_object_coordinates.sql
-- =============================================================
-- =============================================================
-- Adress-Verifizierung
-- Migration: latitude/longitude für public.objects
--
-- Speichert die per OpenRouteService-Geocoding verifizierten
-- Koordinaten einer Adresse. NULL = Adresse (noch) nicht verifiziert.
-- =============================================================

alter table public.objects
  add column latitude double precision,
  add column longitude double precision;

comment on column public.objects.latitude is
  'Breitengrad der verifizierten Adresse (ORS-Geocoding). NULL = nicht verifiziert.';
comment on column public.objects.longitude is
  'Längengrad der verifizierten Adresse (ORS-Geocoding). NULL = nicht verifiziert.';


-- =============================================================
-- 20260801000001_structured_object_items.sql
-- =============================================================
-- =============================================================
-- Strukturierte Items (Menge/Bezeichnung/Bemerkung)
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


-- =============================================================
-- 20260801000002_key_numbers_and_item_photos.sql
-- =============================================================
-- =============================================================
-- Schlüssel-Nummern, Item-Fotos, Storage
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


-- =============================================================
-- 20260801000003_auth_passkeys_and_rls.sql
-- =============================================================
-- =============================================================
-- Auth: Passkeys (WebAuthn), RLS
-- =============================================================
-- 1. profiles.email        (Login-Mapping Benutzername -> E-Mail)
-- 2. public.passkeys       (WebAuthn-Credentials: Fingerabdruck/Face ID)
-- 3. public.webauthn_challenges (flüchtige Challenge-Speicherung)
-- 4. RLS auf allen Tabellen aktivieren (nur authentifizierte Nutzer)

-- ------------------------------------------------------------------
-- 1. profiles: email-Spalte (wird vom handle_new_user-Trigger befüllt)
-- ------------------------------------------------------------------
alter table public.profiles
  add column email text;

create unique index profiles_email_key
  on public.profiles (email)
  where email is not null;

-- ------------------------------------------------------------------
-- 2. passkeys-Tabelle
-- ------------------------------------------------------------------
create table public.passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key    text not null,            -- base64url
  counter       bigint not null default 0,
  transports    jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index passkeys_user_id_idx on public.passkeys (user_id);

comment on table public.passkeys is
  'WebAuthn-Passkeys (Fingerabdruck / Face ID) eines Benutzers.';

-- ------------------------------------------------------------------
-- 3. webauthn_challenges-Tabelle (flüchtig, wird nach Verifikation gelöscht)
-- ------------------------------------------------------------------
create table public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  challenge   text not null,
  user_id     uuid references auth.users (id) on delete cascade, -- null bei Login
  purpose     text not null check (purpose in ('registration', 'authentication')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index webauthn_challenges_user_purpose_idx
  on public.webauthn_challenges (user_id, purpose);
create index webauthn_challenges_expires_idx
  on public.webauthn_challenges (expires_at);

-- ------------------------------------------------------------------
-- 4. RLS: nur authentifizierte Nutzer haben Zugriff
-- ------------------------------------------------------------------
alter table public.objects enable row level security;
create policy "objects_authenticated_all"
  on public.objects for all
  to authenticated
  using (true)
  with check (true);

alter table public.object_items enable row level security;
create policy "object_items_authenticated_all"
  on public.object_items for all
  to authenticated
  using (true)
  with check (true);

alter table public.active_tours enable row level security;
create policy "active_tours_authenticated_all"
  on public.active_tours for all
  to authenticated
  using (true)
  with check (true);

alter table public.tour_stops enable row level security;
create policy "tour_stops_authenticated_all"
  on public.tour_stops for all
  to authenticated
  using (true)
  with check (true);

alter table public.weekly_default_routes enable row level security;
create policy "weekly_default_routes_authenticated_all"
  on public.weekly_default_routes for all
  to authenticated
  using (true)
  with check (true);

alter table public.passkeys enable row level security;
create policy "passkeys_own_all"
  on public.passkeys for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.webauthn_challenges enable row level security;
create policy "webauthn_challenges_authenticated_all"
  on public.webauthn_challenges for all
  to authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------------
-- 5. profiles: eigener Account darf bearbeitet werden (Benutzername)
-- ------------------------------------------------------------------
create policy "profiles_own_update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------------------------
-- 6. handle_new_user-Trigger: auch E-Mail übernehmen
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in ('driver', 'admin', 'facility_manager')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end,
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        name  = coalesce(public.profiles.name, excluded.name),
        role  = public.profiles.role;
  return new;
end;
$$;


-- =============================================================
-- 20260801000004_seed_admin.sql
-- =============================================================
-- =============================================================
-- Auth: Seed-Admin-Account
-- =============================================================
-- Legt den initialen Administrator an:
--   Benutzername: Admin (Login-Kennung -> E-Mail admin@company.local)
--   Passwort:     bitte-aendern!   (nach dem ersten Login ändern)
-- Idempotent: läuft nur, wenn der Account noch nicht existiert.
--
-- Hinweis: Der on_auth_user_created-Trigger (Migration 1/3) legt das
-- public.profiles automatisch an (name = 'Admin', role = 'admin').
-- =============================================================

-- pgcrypto für crypt()/gen_salt() sicherstellen
create extension if not exists pgcrypto with schema extensions;

-- Fest vergebene UUIDs für den Admin (stable über Re-Deploys)
do $$
declare
  v_user_id uuid := '00000000-0000-0000-0000-000000000001';
  v_email   text := 'admin@company.local';
  v_name    text := 'Admin';
  v_password text := 'bitte-aendern!';
begin
  if not exists (select 1 from auth.users where id = v_user_id)
     and not exists (select 1 from auth.users where email = v_email) then

    insert into auth.users (
      instance_id, id, aud, role,
      email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('name', v_name, 'role', 'admin'),
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );

    -- Profil explizit setzen (falls Trigger noch nicht griff)
    insert into public.profiles (id, name, role, email)
    values (v_user_id, v_name, 'admin', v_email)
    on conflict (id) do update
      set role = 'admin', email = excluded.email;

  end if;
end $$;


-- =============================================================
-- 20260801000005_user_scoped_planning.sql
-- =============================================================
-- =============================================================
-- Nutzerbezogene Tourenplanung
-- =============================================================
-- Änderungen:
--   1. weekly_default_routes.user_id  -> jeder Nutzer hat seine eigene
--      Vorauswahl pro Wochentag („jeder plant seine eigene Tour")
--   2. save_weekly_defaults(p_user_id, p_day_of_week, p_object_ids)
--   3. Index auf active_tours.driver_id für die Tourenhistorie
-- =============================================================

-- ------------------------------------------------------------------
-- 1. weekly_default_routes: user_id (per Nutzer)
-- ------------------------------------------------------------------
alter table public.weekly_default_routes
  add column user_id uuid references auth.users (id) on delete cascade;

-- Bestehende Zeilen dem Seed-Admin zuordnen (frühere globale Defaults).
update public.weekly_default_routes
set user_id = '00000000-0000-0000-0000-000000000001'
where user_id is null;

alter table public.weekly_default_routes
  alter column user_id set not null;

-- Unique-Constraint: pro Nutzer + Wochentag + Objekt
alter table public.weekly_default_routes
  drop constraint weekly_default_routes_day_of_week_object_id_key;

alter table public.weekly_default_routes
  add constraint weekly_default_routes_user_day_object_key
  unique (user_id, day_of_week, object_id);

-- Index für schnellen Zugriff pro Nutzer
drop index if exists weekly_default_routes_day_order_idx;
create index weekly_default_routes_user_day_order_idx
  on public.weekly_default_routes (user_id, day_of_week, selection_order);

-- ------------------------------------------------------------------
-- 2. save_weekly_defaults: nutzerbezogen
-- ------------------------------------------------------------------
create or replace function public.save_weekly_defaults(
  p_user_id uuid,
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

  -- Bestehende Auswahl des Nutzers für den Wochentag vollständig ersetzen
  delete from public.weekly_default_routes
  where user_id = p_user_id and day_of_week = p_day_of_week;

  -- Neu einfügen: Duplikate entfernen, nur existierende Objekte,
  -- selection_order = Position in der übergebenen Liste (0-basiert)
  for entry in
    select distinct on (t.obj_id) t.obj_id, t.ord
    from unnest(p_object_ids) with ordinality as t(obj_id, ord)
    where exists (select 1 from public.objects o where o.id = t.obj_id)
    order by t.obj_id, t.ord
  loop
    insert into public.weekly_default_routes (user_id, day_of_week, object_id, selection_order)
    values (p_user_id, p_day_of_week, entry.obj_id, entry.ord - 1);
  end loop;
end;
$$;

grant execute on function public.save_weekly_defaults(uuid, integer, uuid[]) to authenticated;

-- ------------------------------------------------------------------
-- 3. Index für die Tourenhistorie (Filter auf driver_id)
-- ------------------------------------------------------------------
create index active_tours_driver_id_idx on public.active_tours (driver_id);


-- =============================================================
-- 20260803000000_object_admin_info.sql
-- =============================================================
-- =============================================================
-- Admin-Info am Objekt (Foto-Import Items)
-- =============================================================
-- Änderungen:
--   1. objects.customer          (Kunde / Ansprechpartner)
--   2. objects.customer_number   (Kundennummer)
--   3. objects.cleaning_interval (Reinigungsturnus)
--
-- Diese Felder werden beim Foto-Import (Items) per KI erkannt und
-- gespeichert und sind nur für Admins sichtbar (die API liefert sie
-- für Nicht-Admins nicht aus).
-- =============================================================

alter table public.objects
  add column customer text;

alter table public.objects
  add column customer_number text;

alter table public.objects
  add column cleaning_interval text;

comment on column public.objects.customer is
  'Kunde (Firma/Ansprechpartner) – nur für Admins sichtbar.';
comment on column public.objects.customer_number is
  'Kundennummer – nur für Admins sichtbar.';
comment on column public.objects.cleaning_interval is
  'Reinigungsturnus (z. B. wöchentlich) – nur für Admins sichtbar.';


-- =============================================================
-- 20260804000000_inventory_items.sql
-- =============================================================
-- =============================================================
-- Inventar (Item-Katalog, Admin)
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


-- =============================================================
-- 20260804000001_object_remarks.sql
-- =============================================================
-- =============================================================
-- Objekt-Bemerkung
-- =============================================================
-- Änderungen:
--   1. objects.remark (Bemerkung zum Objekt)
--
-- Die Bemerkung ist für alle Rollen sichtbar (Fahrer, Admin, ...),
-- bearbeitet werden kann sie nur von Admins (die API-Routen für
-- Objekte sind ohnehin admin-only).
-- =============================================================

alter table public.objects
  add column remark text;

comment on column public.objects.remark is
  'Bemerkung zum Objekt (für alle sichtbar, z. B. Zugangshinweise). Nur Admins können sie bearbeiten.';


-- =============================================================
-- 20260804000002_offline_sync_columns.sql
-- =============================================================
-- =============================================================
-- Offline-First-Sync (LWW)
-- Migration: client_updated_at / synced_at / updated_at
--
-- Änderungen:
--   1. set_updated_at() bevorzugt künftig client_updated_at
--      (updated_at = client_updated_at, falls gesetzt; sonst now())
--   2. Neue Spalten auf allen synchronisierbaren Tabellen:
--        client_updated_at timestamptz  (LWW-Basis, Client-Zeitstempel)
--        synced_at         timestamptz  (Serverzeit des letzten Syncs)
--   3. object_items & tour_stops erhalten zusätzlich ein bislang
--      fehlendes updated_at (inkl. Trigger)
--
-- Hinweis: Keine sync_tombstones-Tabelle – Löschen passiert bewusst
-- nur online (siehe SPEC.md, Abschnitt 6).
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Trigger-Funktion: updated_at bevorzugt client_updated_at
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.client_updated_at is not null then
    new.updated_at = new.client_updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- 2. Neue Spalten je Tabelle
-- ------------------------------------------------------------------

-- profiles
alter table public.profiles
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.profiles.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.profiles.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- objects
alter table public.objects
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.objects.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.objects.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- object_items (bekommt zusätzlich updated_at)
alter table public.object_items
  add column updated_at timestamptz not null default now(),
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.object_items.updated_at is
  'Zeitpunkt der letzten Änderung (basiert auf client_updated_at, falls vorhanden).';
comment on column public.object_items.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.object_items.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- inventory_items
alter table public.inventory_items
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.inventory_items.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.inventory_items.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- weekly_default_routes
alter table public.weekly_default_routes
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.weekly_default_routes.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.weekly_default_routes.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- active_tours
alter table public.active_tours
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.active_tours.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.active_tours.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- tour_stops (bekommt zusätzlich updated_at)
alter table public.tour_stops
  add column updated_at timestamptz not null default now(),
  add column client_updated_at timestamptz,
  add column synced_at timestamptz;

comment on column public.tour_stops.updated_at is
  'Zeitpunkt der letzten Änderung (basiert auf client_updated_at, falls vorhanden).';
comment on column public.tour_stops.client_updated_at is
  'Zeitpunkt der letzten Bearbeitung auf dem Gerät (LWW-Basis). NULL = nie offline bearbeitet.';
comment on column public.tour_stops.synced_at is
  'Serverzeit, wann der Datensatz zuletzt synchronisiert wurde.';

-- ------------------------------------------------------------------
-- 3. updated_at-Trigger für object_items & tour_stops
-- ------------------------------------------------------------------
create trigger set_object_items_updated_at
  before update on public.object_items
  for each row execute function public.set_updated_at();

create trigger set_tour_stops_updated_at
  before update on public.tour_stops
  for each row execute function public.set_updated_at();


-- =============================================================
-- 20260805000000_tour_stop_key_numbers.sql
-- =============================================================
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


-- =============================================================
-- 20260805000001_repair_tour_stop_key_numbers.sql
-- =============================================================
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


-- =============================================================
-- 20260806000000_last_delivery_and_reserved_items.sql
-- =============================================================
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


-- =============================================================
-- 20260806000001_time_tracking.sql
-- =============================================================
-- =============================================================
-- Zeiterfassung & Urlaubsverwaltung
-- Migration 20260806000001
-- =============================================================

-- Neue Mitarbeiterrollen. PostgreSQL führt ALTER TYPE außerhalb eines
-- Transaktionsblocks aus; IF NOT EXISTS macht die Migration idempotenter.
alter type public.user_role add value if not exists 'cleaner';
alter type public.user_role add value if not exists 'substitute';

alter table public.profiles
  add column if not exists vacation_days_total integer not null default 30,
  add column if not exists vacation_days_used integer not null default 0,
  add column if not exists overtime_hours numeric(6,2) not null default 0.00;

create type public.time_off_type as enum (
  'vacation',
  'sick_leave',
  'unpaid',
  'compensatory'
);

create type public.time_off_status as enum (
  'pending',
  'approved',
  'rejected'
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  break_duration_minutes integer not null default 0,
  note text,
  is_approved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz,
  synced_at timestamptz,
  constraint time_entries_break_duration_nonnegative
    check (break_duration_minutes >= 0),
  constraint time_entries_clock_order
    check (clock_out is null or clock_out >= clock_in)
);

create table public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.time_off_type not null,
  start_date date not null,
  end_date date not null,
  status public.time_off_status not null default 'pending',
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz,
  synced_at timestamptz,
  constraint time_off_requests_date_order check (end_date >= start_date)
);

create unique index time_entries_one_open_per_user_idx
  on public.time_entries (user_id)
  where clock_out is null;

create index time_entries_user_clock_in_idx
  on public.time_entries (user_id, clock_in desc);
create index time_entries_open_user_idx
  on public.time_entries (user_id)
  where clock_out is null;
create index time_off_requests_user_dates_idx
  on public.time_off_requests (user_id, start_date, end_date);

create trigger set_time_entries_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();

create trigger set_time_off_requests_updated_at
  before update on public.time_off_requests
  for each row execute function public.set_updated_at();

alter table public.time_entries enable row level security;
alter table public.time_off_requests enable row level security;

create policy "time_entries_own_read"
  on public.time_entries for select
  using (auth.uid() = user_id or public.current_user_role() = 'admin');

create policy "time_entries_own_insert"
  on public.time_entries for insert
  with check (auth.uid() = user_id or public.current_user_role() = 'admin');

create policy "time_entries_admin_update"
  on public.time_entries for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "time_entries_admin_delete"
  on public.time_entries for delete
  using (public.current_user_role() = 'admin');

create policy "time_off_requests_own_read"
  on public.time_off_requests for select
  using (auth.uid() = user_id or public.current_user_role() = 'admin');

create policy "time_off_requests_own_insert"
  on public.time_off_requests for insert
  with check (auth.uid() = user_id or public.current_user_role() = 'admin');

create policy "time_off_requests_admin_update"
  on public.time_off_requests for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "time_off_requests_admin_delete"
  on public.time_off_requests for delete
  using (public.current_user_role() = 'admin');

comment on table public.time_entries is
  'Arbeitszeit-Stempelungen mit Offline-First-LWW-Feldern.';
comment on table public.time_off_requests is
  'Urlaubs-, Krankheits- und sonstige Abwesenheitsanträge.';


-- =============================================================
-- 20260806000002_time_tracking_role_trigger.sql
-- =============================================================
-- =============================================================
-- Zeiterfassung: Rollen im Auth-Trigger
-- Migration 20260806000002
--
-- Separat nach 20260806000001, damit die neu hinzugefügten Enum-Werte
-- sicher committed sind, bevor die Triggerfunktion sie verwendet.
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in
        ('driver', 'admin', 'facility_manager', 'cleaner', 'substitute')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- =============================================================
-- 20260806000003_time_tracking_completion.sql
-- =============================================================
-- Ergänzungen für Phase 2–4 der Zeiterfassung.
-- Diese Migration ist bewusst unabhängig von der initialen Enum-/Tabellenmigration.

alter table public.time_off_requests
  add column if not exists employee_note text;

comment on column public.time_off_requests.employee_note is
  'Optionale Notiz des Mitarbeiters zum Abwesenheitsantrag.';

-- Urlaubskonto-Buchung: Wird ein Urlaubsantrag genehmigt, werden die Tage auf
-- profiles.vacation_days_used verbucht; bei Ablehnung/Widerruf wieder abgezogen.
create or replace function public.apply_time_off_approval_accounting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vacation_delta integer := 0;
  request_days integer;
begin
  if new.type = 'vacation' then
    request_days := (new.end_date - new.start_date) + 1;
    if new.status = 'approved' and coalesce(old.status, 'pending') <> 'approved' then
      vacation_delta := request_days;
    elsif new.status <> 'approved' and old.status = 'approved' then
      vacation_delta := -request_days;
    end if;
  end if;

  if vacation_delta <> 0 then
    update public.profiles
       set vacation_days_used = greatest(0, vacation_days_used + vacation_delta)
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_time_off_approval_accounting on public.time_off_requests;
create trigger apply_time_off_approval_accounting
after update of status on public.time_off_requests
for each row execute function public.apply_time_off_approval_accounting();

comment on function public.apply_time_off_approval_accounting() is
  'Bucht Urlaubstage bei Statuswechsel. Hinweis: Zeitraumänderungen an bereits genehmigten Anträgen werden nicht automatisch nachgebucht (nur Statuswechsel).';

-- Einmalige Korrektur für bereits vor dieser Migration genehmigte Urlaubsanträge.
update public.profiles p
set vacation_days_used = coalesce(approved.days_used, 0)
from (
  select user_id, sum((end_date - start_date) + 1)::integer as days_used
  from public.time_off_requests
  where type = 'vacation' and status = 'approved'
  group by user_id
) approved
where p.id = approved.user_id;


-- =============================================================
-- 20260807000000_object_assignments.sql
-- =============================================================
-- =============================================================
-- Objektbetreuer (facility_manager)
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


-- =============================================================
-- 20260808000000_reinigungskraft_contract_type.sql
-- =============================================================
-- =============================================================
-- Reinigungskraft & Vertragsart
-- Migration 20260808000000
--
-- 1. Die Rolle „Reiniger" (cleaner) entfällt: Bestehende Reiniger
--    werden Reinigungskräfte (facility_manager, Funktionsweise
--    unverändert). Der Enum-Wert wird entfernt, sofern die
--    Datenbank-Version das unterstützt (PostgreSQL 16+).
-- 2. profiles.contract_type: Vollzeit (40 h/Woche), Teilzeit
--    (20 h/Woche), Minijob (10 h/Woche) – Grundlage für den
--    automatischen Soll/Ist-Vergleich im Überstundenkonto.
-- =============================================================

-- ------------------------------------------------------------------
-- 1. Reiniger -> Reinigungskraft (facility_manager)
-- ------------------------------------------------------------------
update public.profiles
   set role = 'facility_manager'
 where role = 'cleaner';

-- Enum-Wert entfernen (nur PostgreSQL >= 16 kann Enum-Werte droppen;
-- ältere Versionen lassen den Wert ungenutzt stehen – harmlos, da die
-- App ihn nicht mehr verwendet). Fehler werden bewusst geschluckt,
-- damit die Migration auch in Transaktionsblöcken durchläuft.
do $$
begin
  if current_setting('server_version_num')::int >= 160000 then
    begin
      execute 'alter type public.user_role drop value if exists ''cleaner''';
    exception when others then
      raise notice 'Enum-Wert "cleaner" konnte nicht entfernt werden: %', sqlerrm;
    end;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 2. Vertragsart (Soll-Arbeitszeit je Woche)
-- ------------------------------------------------------------------
create type public.contract_type as enum (
  'full_time',
  'part_time',
  'mini_job'
);

alter table public.profiles
  add column if not exists contract_type public.contract_type not null default 'full_time';

comment on column public.profiles.contract_type is
  'Vertragsart: full_time (40 h/Woche), part_time (20 h/Woche), mini_job (10 h/Woche). Steuert den automatischen Soll/Ist-Vergleich im Überstundenkonto.';

-- ------------------------------------------------------------------
-- 3. Auth-Trigger ohne „cleaner" aktualisieren (der Enum-Wert darf
--    nicht mehr gesetzt werden) + Vertragsart aus User-Metadaten
--    übernehmen (Fallback: Vollzeit).
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role, contract_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in
        ('driver', 'admin', 'facility_manager', 'substitute')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end,
    case
      when new.raw_user_meta_data ->> 'contract_type' in
        ('full_time', 'part_time', 'mini_job')
        then (new.raw_user_meta_data ->> 'contract_type')::public.contract_type
      else 'full_time'::public.contract_type
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- =============================================================
-- 20260808000001_time_entry_source.sql
-- =============================================================
-- =============================================================
-- Zeiterfassung: Herkunft der Einträge
-- Migration 20260808000001
-- =============================================================
-- `source` unterscheidet normale Stempelungen (Stempeluhr) von
-- nachgereichter Arbeitszeit. Die Admin-Ansicht zeigt daraus:
--   - 'clock'     → „Gestempelt"
--   - 'submitted' + is_approved = true  → „Freigegeben"
--   - 'submitted' + is_approved = false → „Ausstehend"
-- Bestehende Einträge gelten als normal gestempelt.

create type public.time_entry_source as enum ('clock', 'submitted');

alter table public.time_entries
  add column if not exists source public.time_entry_source not null default 'clock';

-- Noch offene (nicht freigegebene) Nachreichungen bleiben im Freigabe-Feed
-- sichtbar; alle übrigen Alt-Einträge gelten als normal gestempelt.
update public.time_entries
  set source = 'submitted'
  where is_approved = false;

comment on column public.time_entries.source is
  'Herkunft des Eintrags: clock = Stempeluhr, submitted = nachgereichte Arbeitszeit.';


-- =============================================================
-- 20260808000002_timeout_review.sql
-- =============================================================
-- =============================================================
-- Zeiterfassung: Auto-Timeout & Prüfbedarf
-- Migration 20260808000002
-- =============================================================
-- Vergessene Ausstempelungen werden automatisch als „prüfbedürftig"
-- markiert, sobald eine offene Stempelung (clock_out IS NULL)
--   - die 12-Stunden-Marke überschreitet ODER
--   - Mitternacht (00:00 Uhr, Europa/Berlin) erreicht.
-- Solche Einträge erhalten requires_review = true und is_approved = false,
-- erscheinen im Freigabe-Feed der Verwaltung und fließen solange NICHT in
-- Wochen-/Monatssummen oder das Überstundenkonto ein.
--
-- Der Trigger markiert bei jedem Schreibvorgang; die Funktion
-- flag_overdue_time_entries() fängt offene Einträge ab, die „im Stillen"
-- überfällig geworden sind (wird bei jedem Lese-/Schreib-Zugriff aufgerufen).

alter table public.time_entries
  add column if not exists requires_review boolean not null default false;

comment on column public.time_entries.requires_review is
  'true = Eintrag ist prüfbedürftig (vergessene Ausstempelung / wartet auf Prüfung).';

-- ------------------------------------------------------------------
-- Trigger: Flags bei Schreibvorgängen setzen/zurücksetzen
-- ------------------------------------------------------------------
create or replace function public.set_time_entry_review_flag()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  overdue boolean;
begin
  -- Überfällig = offen UND (12 h überschritten ODER Mitternacht erreicht).
  overdue := new.clock_out is null
    and (
      now() - new.clock_in >= interval '12 hours'
      or new.clock_in < (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
    );

  if overdue then
    new.is_approved := false;
    new.requires_review := true;
  elsif new.clock_out is not null and new.is_approved then
    -- Abgeschlossen + freigegeben (normales Ausstempeln oder Admin-Freigabe):
    -- Prüfbedarf ist gelöst.
    new.requires_review := false;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_review_flag on public.time_entries;
create trigger time_entries_review_flag
  before insert or update on public.time_entries
  for each row execute function public.set_time_entry_review_flag();

-- ------------------------------------------------------------------
-- Housekeeping: im Stillen überfällig gewordene Einträge nachträglich markieren
-- ------------------------------------------------------------------
create or replace function public.flag_overdue_time_entries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  flagged integer;
begin
  update public.time_entries
    set requires_review = true,
        is_approved = false
  where clock_out is null
    and not requires_review
    and (
      now() - clock_in >= interval '12 hours'
      or clock_in < (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
    );
  get diagnostics flagged = row_count;
  return flagged;
end;
$$;

-- ------------------------------------------------------------------
-- Backfill: bereits überfällige offene Einträge aus Altbestand markieren
-- ------------------------------------------------------------------
update public.time_entries
  set requires_review = true,
      is_approved = false
where clock_out is null
  and (
    now() - clock_in >= interval '12 hours'
    or clock_in < (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
  );


-- =============================================================
-- 20260809000000_arbzg_breaks_and_audit.sql
-- =============================================================
-- =============================================================
-- Zeiterfassung: ArbZG-Pausen & Audit-Log
-- Migration 20260809000000
-- =============================================================
-- 1) Mindestpause nach § 4 ArbZG:
--    - Anwesenheitszeit (clock_out - clock_in) > 6 bis 9 Stunden → min. 30 Min.
--    - Anwesenheitszeit > 9 Stunden → min. 45 Min.
--    Der Trigger ergänzt die erfasste Pause (break_duration_minutes) automatisch
--    auf die Mindestdauer – bei JEDEM Schreibvorgang (Stempeluhr, Sync,
--    Nachreichung, Admin-Korrektur). Netto-Arbeitszeit bleibt
--    (clock_out - clock_in) - break_duration_minutes (workedMinutesOf).
--
-- 2) Revisionssicheres Änderungsprotokoll time_entry_audit_logs:
--    Wird serverseitig geschrieben, wenn ein Admin eine Stempelung im
--    Zeitadmin anpasst, schließt, freigibt oder löscht.

-- ------------------------------------------------------------------
-- 1) Mindestpause (§ 4 ArbZG)
-- ------------------------------------------------------------------
create or replace function public.enforce_min_break()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  presence_minutes integer;
  min_break integer;
begin
  if new.clock_out is not null then
    presence_minutes := floor(extract(epoch from (new.clock_out - new.clock_in)) / 60)::int;
    if presence_minutes > 9 * 60 then
      min_break := 45;
    elsif presence_minutes > 6 * 60 then
      min_break := 30;
    else
      min_break := 0;
    end if;
    if min_break > 0 then
      new.break_duration_minutes := greatest(coalesce(new.break_duration_minutes, 0), min_break);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_min_break on public.time_entries;
create trigger time_entries_min_break
  before insert or update on public.time_entries
  for each row execute function public.enforce_min_break();

-- Backfill: bereits abgeschlossene Einträge auf die Mindestpause anheben.
update public.time_entries
  set break_duration_minutes = greatest(
        break_duration_minutes,
        (case
          when floor(extract(epoch from (clock_out - clock_in)) / 60) > 9 * 60 then 45
          when floor(extract(epoch from (clock_out - clock_in)) / 60) > 6 * 60 then 30
          else 0
        end)::int
      )
where clock_out is not null;

-- ------------------------------------------------------------------
-- 2) Audit-Log
-- ------------------------------------------------------------------
create table public.time_entry_audit_logs (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid references public.time_entries (id) on delete set null,
  changed_by_user_id uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb,
  change_reason text
);

create index time_entry_audit_logs_entry_idx
  on public.time_entry_audit_logs (time_entry_id, changed_at desc);

comment on table public.time_entry_audit_logs is
  'Revisionssicheres Änderungsprotokoll für Zeiteinträge (Admin-Anpassungen, -Freigaben, -Löschungen).';

alter table public.time_entry_audit_logs enable row level security;

-- Lesen nur für Admins; Schreiben ausschließlich serverseitig (Service-Rolle).
create policy "time_entry_audit_logs_admin_read"
  on public.time_entry_audit_logs for select
  using (public.current_user_role() = 'admin');


-- =============================================================
-- 20260810000000_custom_contract_type.sql
-- =============================================================
-- =============================================================
-- Individuelle Verträge (custom)
-- Migration 20260810000000
--
-- Erweitert das Vertragsarten-Enum um 'custom' für benutzerdefinierte
-- Verträge mit eigenen Sollstunden, Arbeitstagen und Urlaubstagen.
--
-- Hinweis: Der Enum-Wert wird in einer eigenen Migration angelegt,
-- damit der ADD VALUE nicht in derselben Transaktion wie seine
-- Verwendung steht (Postgres: "unsafe use of new value of enum type").
-- =============================================================

alter type public.contract_type add value if not exists 'custom';


-- =============================================================
-- 20260810000001_custom_contract_columns.sql
-- =============================================================
-- =============================================================
-- Individuelle Verträge (custom)
-- Migration 20260810000001
--
-- profiles: weekly_target_hours (Wochen-Soll), working_days_per_week,
-- vacation_days_per_year (Jahresurlaub) + Backfill aus Bestandsdaten.
--
-- Resturlaub überall = vacation_days_per_year - vacation_days_used.
-- =============================================================

alter table public.profiles
  add column if not exists weekly_target_hours numeric not null default 40,
  add column if not exists working_days_per_week numeric not null default 5,
  add column if not exists vacation_days_per_year integer not null default 30;

comment on column public.profiles.weekly_target_hours is
  'Wochen-Sollstunden fürs Überstundenkonto (full_time 40, part_time 20, mini_job 10, custom = individuell).';
comment on column public.profiles.working_days_per_week is
  'Geplante Arbeitstage pro Woche (custom; Basis für den Urlaubsanspruch).';
comment on column public.profiles.vacation_days_per_year is
  'Individuelle Jahresurlaubstage. Resturlaub = vacation_days_per_year - vacation_days_used.';

-- Bestandsdaten: Vertrags-Defaults je Vertragsart übernehmen (identisch
-- mit CONTRACT_DEFAULTS in der App) und bestehende Gesamtansprüche (inkl.
-- manueller Korrekturen) als Jahresurlaub übernehmen, damit sich keine
-- Resturlaubs-Anzeige ändert.
update public.profiles
   set weekly_target_hours = case contract_type
         when 'part_time' then 20
         when 'mini_job' then 10
         else 40 end,
       working_days_per_week = case contract_type
         when 'mini_job' then 2
         else 5 end,
       vacation_days_per_year = greatest(coalesce(vacation_days_total, 30), 1);

-- ------------------------------------------------------------------
-- Auth-Trigger: neue Vertragsfelder aus User-Metadaten übernehmen
-- (Fallback je Vertragsart: 40/5/30 – Vollzeit).
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contract_type;
begin
  v_contract := case
    when new.raw_user_meta_data ->> 'contract_type' in
      ('full_time', 'part_time', 'mini_job', 'custom')
      then (new.raw_user_meta_data ->> 'contract_type')::public.contract_type
    else 'full_time'::public.contract_type
  end;

  insert into public.profiles (id, name, role, contract_type,
    weekly_target_hours, working_days_per_week, vacation_days_per_year)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case
      when new.raw_user_meta_data ->> 'role' in
        ('driver', 'admin', 'facility_manager', 'substitute')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else 'driver'::public.user_role
    end,
    v_contract,
    case v_contract when 'part_time' then 20 when 'mini_job' then 10 else 40 end,
    case v_contract when 'mini_job' then 2 else 5 end,
    case v_contract when 'mini_job' then 12 else 30 end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- =============================================================
-- 20260811000000_undeliverable_stops.sql
-- =============================================================
-- =============================================================
-- „Nicht lieferbar" an Tour-Stopps
-- Migration 20260811000000
--
-- Stopps können als „nicht lieferbar" markiert werden (Objekt zu,
-- Zutritt verweigert, Schlüssel fehlt, ...) – optional mit Grund.
-- Dadurch kann eine Tour auch dann abgeschlossen werden, wenn
-- nicht alle Stopps beliefert wurden (keine falschen „beliefert"-
-- Haken mehr). Belieferung (is_delivered) und „nicht lieferbar"
-- schließen sich gegenseitig aus; die bestehenden Trigger
-- (last_delivery, is_reserved-Reset) greifen nur bei echter
-- Belieferung und bleiben unverändert.
--
-- Idempotent: `add column if not exists` – kann bedenkenlos
-- mehrfach ausgeführt werden (Supabase SQL-Editor).
-- =============================================================

alter table public.tour_stops
  add column if not exists is_undeliverable boolean not null default false;

alter table public.tour_stops
  add column if not exists undeliverable_reason text;

comment on column public.tour_stops.is_undeliverable is
  'Stopp konnte nicht beliefert werden (Objekt zu, Zutritt verweigert, ...). Schließt is_delivered aus.';

comment on column public.tour_stops.undeliverable_reason is
  'Optionaler Grund, warum der Stopp nicht beliefert werden konnte (z. B. „Objekt geschlossen").';


-- =============================================================
-- 20260812000000_realtime_publication.sql
-- =============================================================
-- =============================================================
-- Realtime: Publication für postgres_changes
-- Migration 20260812000000
--
-- Supabase Realtime (postgres_changes) liefert nur dann Events,
-- wenn die betroffene Tabelle in der `supabase_realtime`-Publication
-- enthalten ist. Ohne das kommen keine Push-Updates an – die Seiten
-- aktualisieren sich erst nach einem manuellen F5.
--
-- Hier werden die Tabellen aufgenommen, auf die die Admin-Seiten
-- per useRealtimeRefresh() subscriben:
--   * profiles            (Status/Rolle/Name der Mitarbeiter)
--   * time_entries        (Einstempeln/Ausstempeln -> "Aktiv"/"Nicht aktiv")
--   * time_off_requests   (neue Anträge / Statuswechsel)
--   * active_tours        (Tourenstart/-abschluss für die Historie)
--
-- Idempotent: bereits enthaltene Tabellen werden übersprungen
-- (SQLSTATE 42710 duplicate_object), falls sie z. B. schon manuell
-- im Dashboard hinzugefügt wurden.
-- =============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'time_entries',
    'time_off_requests',
    'active_tours'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      -- Tabelle ist bereits Mitglied der Publication – kein Fehler.
      null;
    end;
  end loop;
end
$$;


-- =============================================================
-- 20260823000000_time_off_substitute.sql
-- =============================================================
-- =============================================================
-- Abwesenheitskalender: Vertretung
-- Migration 20260823000000
-- =============================================================
-- Vertretung ist kein eigener Abwesenheitstyp. Sie wird als zusätzliches
-- Kalenderereignis auf dem ausgewählten Mitarbeiter dargestellt.

alter table public.time_off_requests
  add column if not exists substitute_id uuid references auth.users (id) on delete set null;

alter table public.time_off_requests
  drop constraint if exists time_off_requests_substitute_not_requester;

alter table public.time_off_requests
  add constraint time_off_requests_substitute_not_requester
  check (substitute_id is null or substitute_id <> user_id);

create index if not exists time_off_requests_substitute_dates_idx
  on public.time_off_requests (substitute_id, start_date, end_date)
  where substitute_id is not null;

comment on column public.time_off_requests.substitute_id is
  'Optionaler Mitarbeiter, der die Vertretung für diesen Abwesenheitszeitraum übernimmt.';

-- Admin-Nachträge können direkt als genehmigt angelegt werden. Der bestehende
-- Statuswechsel-Trigger greift bei INSERT nicht, daher wird die Buchung hier
-- einmalig für diesen Schreibpfad ergänzt.
create or replace function public.apply_time_off_insert_accounting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'vacation' and new.status = 'approved' then
    update public.profiles
       set vacation_days_used = greatest(0, vacation_days_used + ((new.end_date - new.start_date) + 1))
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_time_off_insert_accounting on public.time_off_requests;
create trigger apply_time_off_insert_accounting
after insert on public.time_off_requests
for each row execute function public.apply_time_off_insert_accounting();


-- =============================================================
-- 20260824000000_chat_system.sql
-- =============================================================
-- Chat, Broadcasts und Nachrichtenstatus
create type public.chat_message_kind as enum ('text', 'image', 'audio');
create type public.chat_message_status as enum ('sent', 'delivered', 'read');

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references auth.users(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (employee_id, admin_id),
  constraint chat_threads_distinct_users check (employee_id <> admin_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind public.chat_message_kind not null default 'text',
  body text,
  media_path text,
  media_mime_type text,
  transcript text,
  is_urgent boolean not null default false,
  status public.chat_message_status not null default 'sent',
  delivered_at timestamptz,
  read_at timestamptz,
  understood_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_messages_content check (body is not null or media_path is not null)
);

create table public.chat_translations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  language text not null,
  translated_body text not null,
  created_at timestamptz not null default now(),
  unique (message_id, language)
);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_translations enable row level security;

create policy "chat_threads_participants_read" on public.chat_threads for select using (auth.uid() = employee_id or auth.uid() = admin_id or public.current_user_role() = 'admin');
create policy "chat_threads_participants_insert" on public.chat_threads for insert with check ((auth.uid() = employee_id and public.current_user_role() <> 'admin' and exists (select 1 from public.profiles p where p.id = admin_id and p.role = 'admin')) or (public.current_user_role() = 'admin' and auth.uid() = admin_id and exists (select 1 from public.profiles p where p.id = employee_id and p.role <> 'admin')));
create policy "chat_messages_participants_read" on public.chat_messages for select using (exists (select 1 from public.chat_threads t where t.id = thread_id and (auth.uid() = t.employee_id or auth.uid() = t.admin_id or public.current_user_role() = 'admin')));
create policy "chat_messages_participants_insert" on public.chat_messages for insert with check (auth.uid() = sender_id and exists (select 1 from public.chat_threads t where t.id = thread_id and (auth.uid() = t.employee_id or auth.uid() = t.admin_id)));
create policy "chat_translations_participants_read" on public.chat_translations for select using (exists (select 1 from public.chat_messages m join public.chat_threads t on t.id = m.thread_id where m.id = message_id and (auth.uid() = t.employee_id or auth.uid() = t.admin_id)));

create index chat_messages_thread_created_idx on public.chat_messages(thread_id, created_at);
create index chat_threads_employee_idx on public.chat_threads(employee_id);
create index chat_threads_admin_idx on public.chat_threads(admin_id);

alter table public.profiles add column if not exists chat_preferred_language text;
do $$
begin
  begin alter publication supabase_realtime add table public.chat_threads; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_translations; exception when duplicate_object then null; end;
end $$;

insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', false) on conflict (id) do nothing;


-- =============================================================
-- 20260824000001_chat_remove_context.sql
-- =============================================================
-- Objekt-/Tourbezug ist im Chat nicht Bestandteil des Funktionsumfangs.
alter table public.chat_messages
  drop column if exists object_id,
  drop column if exists tour_id;


-- =============================================================
-- 20260824000002_chat_calls_push.sql
-- =============================================================
-- Telefon- und Push-Unterstützung für Chat
create table if not exists public.company_settings (
  id boolean primary key default true check (id = true),
  support_phone_number text,
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values (true) on conflict (id) do nothing;

alter table public.profiles add column if not exists phone text;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.company_settings enable row level security;
alter table public.push_subscriptions enable row level security;
create policy "company_settings_read_authenticated" on public.company_settings for select to authenticated using (true);
create policy "company_settings_admin_write" on public.company_settings for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "push_subscriptions_owner" on public.push_subscriptions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Mitarbeiter dürfen ausschließlich ihre eigene Telefonnummer ändern.
drop policy if exists "profiles_own_phone_update" on public.profiles;
create policy "profiles_own_phone_update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);


-- =============================================================
-- 20260825000000_chat_performance.sql
-- =============================================================
-- Chat performance: support the summary, unread-count and thread-history queries.
create index if not exists chat_messages_thread_created_desc_idx
  on public.chat_messages(thread_id, created_at desc);

create index if not exists chat_messages_thread_unread_idx
  on public.chat_messages(thread_id, sender_id, status)
  where status <> 'read';

create index if not exists chat_threads_employee_created_idx
  on public.chat_threads(employee_id, created_at desc);

create index if not exists chat_threads_admin_created_idx
  on public.chat_threads(admin_id, created_at desc);


-- =============================================================
-- 20260828000000_tour_warehouse_arrival.sql
-- =============================================================
-- =============================================================
-- Tour: geplante Ankunft im Lager
-- Migration 20260828000000
-- =============================================================
-- Beim Start der Tour („Ausfahren beginnen“) wird neben den Ankunftszeiten
-- der Stopps auch die geplante Rückkehr/Ankunft im Lager gespeichert, damit
-- die Tourseite den Lager-Eintrag wie einen normalen Stopp mit Zeit und
-- Navigation anzeigen kann.

alter table public.active_tours
  add column if not exists warehouse_arrival time;

comment on column public.active_tours.warehouse_arrival is
  'Geplante Ankunftszeit zurück im Lager (HH:MM), beim Tourstart aus der Routenberechnung übernommen.';


-- =============================================================
-- 20260828000001_drop_weekly_default_routes.sql
-- =============================================================
-- =============================================================
-- Wochentags-Vorauswahl entfernt
-- Migration 20260828000001
-- =============================================================
-- Das Speichern von Zielen vor dem Packen (automatische Vorauswahl an
-- bestimmten Wochentagen) wurde aus der App entfernt. Die zugehörige
-- Tabelle und der RPC werden daher gelöscht.

drop function if exists public.save_weekly_defaults(uuid, integer, uuid[]);
drop function if exists public.save_weekly_defaults(integer, uuid[]);

drop table if exists public.weekly_default_routes;


-- =============================================================
-- 20260828000200_substitute_requests.sql
-- =============================================================
-- Springer können eigene Vertretungsvorschläge einreichen.
-- HINWEIS: Diese Migration verwendet bewusst die Versionsnummer 202608280002,
-- da 202608280000 bereits für die Tour-Migration vergeben ist.
alter table public.time_off_requests
  add column if not exists substitute_request boolean not null default false,
  add column if not exists substitute_kind text,
  add column if not exists substitute_object_id uuid references public.objects (id) on delete set null;

alter table public.time_off_requests
  drop constraint if exists time_off_requests_substitute_kind_check;
alter table public.time_off_requests
  add constraint time_off_requests_substitute_kind_check
  check (substitute_kind is null or substitute_kind in ('driver', 'facility_manager'));

create index if not exists time_off_requests_substitute_request_idx
  on public.time_off_requests (status, substitute_request, start_date, end_date)
  where substitute_request = true;


-- =============================================================
-- 20260828000300_repair_tour_warehouse_arrival_schema_cache.sql
-- =============================================================
-- Reparatur für bestehende Installationen, bei denen die ursprüngliche
-- warehouse_arrival-Migration bereits als ausgeführt markiert wurde oder
-- PostgREST die neue Spalte noch nicht im Schema-Cache kennt.
alter table public.active_tours
  add column if not exists warehouse_arrival time;

comment on column public.active_tours.warehouse_arrival is
  'Geplante Ankunftszeit zurück im Lager (HH:MM), beim Tourstart aus der Routenberechnung übernommen.';

-- Supabase/PostgREST übernimmt neue Spalten sonst ggf. erst verzögert.
select pg_notify('pgrst', 'reload schema');


-- =============================================================
-- 20260831000000_vacation_workday_accounting.sql
-- =============================================================
-- =============================================================
-- Urlaubstage nach Arbeitstagen
-- Migration 20260831000000
-- =============================================================
-- Urlaub wird nur für genehmigte Urlaubsanträge des aktuellen Kalenderjahres
-- verbucht. Gezählt werden Montag bis Freitag; bei Teilzeit/Minijob wird die
-- Zahl anhand von working_days_per_week proportional auf die hinterlegten
-- Arbeitstage umgerechnet. Konkrete Wochentage sind im Profil nicht hinterlegt.

create or replace function public.calculate_time_off_workdays(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with profile_days as (
    select greatest(coalesce(working_days_per_week, 5), 1) as days_per_week
    from public.profiles
    where id = p_user_id
  ),
  weekdays as (
    select count(*)::numeric as weekday_count
    from generate_series(p_start_date, p_end_date, interval '1 day') as dates(day)
    where extract(isodow from dates.day) between 1 and 5
  )
  select case
    when p_start_date > p_end_date then 0
    else ceil(
      weekdays.weekday_count * coalesce(profile_days.days_per_week, 5) / 5
    )::integer
  end
  from weekdays
  cross join profile_days
$$;

comment on function public.calculate_time_off_workdays(uuid, date, date) is
  'Berechnet Urlaubstage als Montag-Freitag, proportional zu den geplanten Arbeitstagen pro Woche.';

create or replace function public.recalculate_vacation_days_used(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year_start date := make_date(extract(year from current_date)::integer, 1, 1);
  current_year_end date := make_date(extract(year from current_date)::integer, 12, 31);
  calculated_days integer;
begin
  select coalesce(sum(public.calculate_time_off_workdays(
    r.user_id,
    greatest(r.start_date, current_year_start),
    least(r.end_date, current_year_end)
  )), 0)::integer
    into calculated_days
    from public.time_off_requests r
   where r.user_id = p_user_id
     and r.type = 'vacation'
     and r.status = 'approved'
     and r.end_date >= current_year_start
     and r.start_date <= current_year_end;

  update public.profiles
     set vacation_days_used = greatest(calculated_days, 0)
   where id = p_user_id;
end;
$$;

comment on function public.recalculate_vacation_days_used(uuid) is
  'Synchronisiert die genutzten Urlaubstage für das aktuelle Kalenderjahr aus genehmigten Urlaubsanträgen.';

-- Die beiden historischen Trigger würden zusätzlich Kalendertage buchen und
-- müssen daher vor dem neuen zentralen Recalculate-Trigger entfernt werden.
drop trigger if exists apply_time_off_approval_accounting on public.time_off_requests;
drop trigger if exists apply_time_off_insert_accounting on public.time_off_requests;

create or replace function public.sync_vacation_days_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_vacation_days_used(old.user_id);
    return old;
  end if;

  perform public.recalculate_vacation_days_used(new.user_id);
  if tg_op = 'UPDATE' and old.user_id <> new.user_id then
    perform public.recalculate_vacation_days_used(old.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_vacation_days_used on public.time_off_requests;
create trigger sync_vacation_days_used
after insert or update or delete on public.time_off_requests
for each row execute function public.sync_vacation_days_used();

-- Ändert sich die vertragliche Zahl der Arbeitstage, muss die Nutzung der
-- genehmigten Anträge ebenfalls neu bewertet werden.
create or replace function public.sync_vacation_days_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_vacation_days_used(new.id);
  return new;
end;
$$;

drop trigger if exists sync_vacation_days_after_profile_change on public.profiles;
create trigger sync_vacation_days_after_profile_change
after update of working_days_per_week on public.profiles
for each row
when (old.working_days_per_week is distinct from new.working_days_per_week)
execute function public.sync_vacation_days_after_profile_change();

-- Bestehende Konten einmalig aus den genehmigten Anträgen neu aufbauen. Dabei
-- werden auch abgelehnte/stornierte Anträge und Wochenenden korrekt entfernt.
do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform public.recalculate_vacation_days_used(profile_row.id);
  end loop;
end;
$$;


-- =============================================================
-- 20260831000001_fix_minijob_vacation_entitlement.sql
-- =============================================================
-- =============================================================
-- Minijob-Urlaubsanspruch korrigieren
-- Migration 20260831000001
--
-- Bestehende Minijob-Profile tragen teils noch den alten Spalten-Default
-- 30 als Jahresurlaub (`vacation_days_per_year`), obwohl der Minijob-Default
-- 12 Tage beträgt (siehe CONTRACT_DEFAULTS bzw. handle_new_user-Trigger).
-- Die Resturlaub-Anzeige rechnet direkt aus diesem Wert, daher zeigen solche
-- Profile zu Unrecht 30 (für 2 Arbeitstage/Woche) statt 12 Tage.
--
-- Korrigiert werden NUR Profile, bei denen noch der falsche Default (30)
-- gespeichert ist. Manuell angepasste Werte bleiben unverändert.
-- =============================================================

update public.profiles
   set vacation_days_per_year = 12
 where contract_type = 'mini_job'
   and vacation_days_per_year = 30;

-- =============================================================
-- 20260903000000_unknown_tour_targets.sql
-- =============================================================
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

