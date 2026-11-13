-- =============================================================
-- UK rules: Working Time Regulations breaks & Europe/London time
-- Migration 20261113000000
-- =============================================================
-- This template targets the United Kingdom market, so its legal and time
-- defaults deliberately differ from the German original:
--
-- 1) Minimum break (public.enforce_min_break)
--    UK Working Time Regulations 1998, reg. 12: 20 minutes of rest once the
--    working day exceeds 6 hours. There is no second tier – the German ArbZG
--    steps (30 min above 6 h, 45 min above 9 h) do not apply in the UK.
-- 2) Forgotten clock-outs (public.set_time_entry_review_flag,
--    public.flag_overdue_time_entries)
--    "Midnight" is local midnight in Europe/London, not Europe/Berlin.
--
-- Both rules are replaced in place, so an existing deployment only needs to
-- run this migration. Recorded breaks are never reduced, so there is no
-- backfill: entries that already carry a longer German-style break keep it.

-- ------------------------------------------------------------------
-- 1) Minimum break: UK WTR, 20 minutes above 6 hours of presence
-- ------------------------------------------------------------------
create or replace function public.enforce_min_break()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  presence_minutes integer;
  min_break integer;
begin
  if new.clock_out is not null then
    presence_minutes := floor(extract(epoch from (new.clock_out - new.clock_in)) / 60)::int;
    -- UK WTR: 20 minutes once the working day exceeds 6 hours.
    if presence_minutes > 6 * 60 then
      min_break := 20;
    else
      min_break := 0;
    end if;
    if min_break > 0 then
      new.break_duration_minutes := greatest(coalesce(new.break_duration_minutes, 0), min_break);
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_min_break() is
  'Raises the recorded break to the UK statutory minimum (WTR 1998: 20 min above 6 h presence).';

-- ------------------------------------------------------------------
-- 2) Review flag: overdue at 12 h or at local midnight (Europe/London)
-- ------------------------------------------------------------------
create or replace function public.set_time_entry_review_flag()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  overdue boolean;
begin
  overdue := new.clock_out is null
    and (
      now() - new.clock_in >= interval '12 hours'
      or new.clock_in < (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')
    );

  if overdue then
    new.is_approved := false;
    new.requires_review := true;
  elsif new.clock_out is not null and new.is_approved then
    new.requires_review := false;
  end if;
  return new;
end;
$$;

create or replace function public.flag_overdue_time_entries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  flagged integer;
begin
  update public.time_entries
    set requires_review = true,
        is_approved = false
  where clock_out is null
    and not requires_review
    and (
      now() - clock_in >= interval '12 hours'
      or clock_in < (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')
    );
  get diagnostics flagged = row_count;
  return flagged;
end;
$$;
