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
