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
