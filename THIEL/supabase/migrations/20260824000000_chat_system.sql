-- Thiel Dienstleistungen – Chat, Broadcasts und Nachrichtenstatus
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
