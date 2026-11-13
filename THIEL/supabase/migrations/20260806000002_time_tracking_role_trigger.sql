-- =============================================================
-- Thiel Dienstleistungen – Zeiterfassung: Rollen im Auth-Trigger
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
