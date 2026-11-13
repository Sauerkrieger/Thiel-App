-- =============================================================
-- UK vacation entitlement: 28 days (5.6 weeks) instead of 30
-- Migration 20261113000001
-- =============================================================
-- The German original grants 30 days at five working days per week (BUrlG).
-- In England the statutory entitlement is 5.6 weeks, i.e. 28 days including
-- bank holidays for a five-day week. This template therefore defaults to 28.
--
-- Changed:
--   1) column default of profiles.vacation_days_per_year: 30 -> 28
--   2) handle_new_user(): new accounts get 28 (mini job keeps 12 = 5.6 x 2)
--   3) backfill: profiles that still carry the old German default (exactly 30)
--      are moved to 28. Manually agreed values other than 30 stay untouched.
--      Mini-job profiles keep their pro-rata value.
--
-- Everyone remains free to grant more: the field is editable per employee.

alter table public.profiles
  alter column vacation_days_per_year set default 28;

comment on column public.profiles.vacation_days_per_year is
  'Individual annual vacation days. Default 28 (UK statutory 5.6 weeks); mini job 12. Remaining = vacation_days_per_year - vacation_days_used.';

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
    -- UK: 28 days at 5 days/week, mini job pro rata (5.6 weeks x 2 days).
    case v_contract when 'mini_job' then 12 else 28 end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill: the old German default (30) becomes the UK default (28).
update public.profiles
   set vacation_days_per_year = 28
 where contract_type <> 'mini_job'
   and vacation_days_per_year = 30;
