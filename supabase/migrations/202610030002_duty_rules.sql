-- Duty rules per role, replacing the per-shift table (the biometric ES/GS shift codes do not
-- separate people by start time). Agreed rules:
--   * everyone gets a 30-minute grace period after the start time
--   * a full duty day is 8 hours 30 minutes; arriving late is fine if the 8h30 is completed
--   * designers and the EA start at 10:00, supervisors at 11:00
-- Safe to run more than once.

create table if not exists public.duty_rules (
  role_group text primary key check (role_group in ('supervisor', 'designer', 'ea')),
  start_time time not null,
  grace_min int not null default 30 check (grace_min >= 0),
  required_min int not null default 510 check (required_min > 0),
  updated_at timestamptz not null default now()
);

insert into public.duty_rules (role_group, start_time, grace_min, required_min) values
  ('supervisor', '11:00', 30, 510),
  ('designer',   '10:00', 30, 510),
  ('ea',         '10:00', 30, 510)
on conflict (role_group) do nothing;

alter table public.duty_rules enable row level security;
revoke all on public.duty_rules from anon, authenticated;

drop table if exists public.shift_rules;
