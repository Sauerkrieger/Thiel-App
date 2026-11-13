-- =============================================================
-- Thiel Dienstleistungen – Schritt 1 (Basis-Schema)
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
