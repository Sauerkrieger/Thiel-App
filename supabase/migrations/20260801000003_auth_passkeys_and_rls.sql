-- =============================================================
-- Thiel Dienstleistungen – Auth: Passkeys (WebAuthn), RLS
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
