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
