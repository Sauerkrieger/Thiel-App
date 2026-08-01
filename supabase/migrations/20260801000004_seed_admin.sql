-- =============================================================
-- Thiel Dienstleistungen – Auth: Seed-Admin-Account
-- =============================================================
-- Legt den initialen Administrator an:
--   Benutzername: Leon  (Login-Kennung -> E-Mail leon@thiel.local)
--   Passwort:     dKKk!k_ei)2w?2k_
-- Idempotent: läuft nur, wenn der Account noch nicht existiert.
--
-- Hinweis: Der on_auth_user_created-Trigger (Migration 1/3) legt das
-- public.profiles automatisch an (name = 'Leon', role = 'admin').
-- =============================================================

-- pgcrypto für crypt()/gen_salt() sicherstellen
create extension if not exists pgcrypto with schema extensions;

-- Fest vergebene UUIDs für den Admin (stable über Re-Deploys)
do $$
declare
  v_user_id uuid := '00000000-0000-0000-0000-000000000001';
  v_email   text := 'leon@thiel.local';
  v_name    text := 'Leon';
  v_password text := 'dKKk!k_ei)2w?2k_';
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
