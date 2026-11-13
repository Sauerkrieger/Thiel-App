-- =============================================================
-- Thiel Dienstleistungen – Zeiterfassung & Urlaubsverwaltung
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
