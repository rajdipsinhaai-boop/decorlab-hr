-- Scoring engine support: shift rules, KRA parameter definitions, month locks, report-card storage,
-- and "unrated" director ratings. Server-only tables (RLS on, no policies), like the attendance tables.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Shift start times used for the punctuality part of the attendance score
-- ---------------------------------------------------------------------------
create table if not exists public.shift_rules (
  shift_code text primary key,                 -- as printed in the biometric report: ES, GS, DR ...
  start_time time not null,                    -- when the shift is expected to start
  grace_min int not null default 15 check (grace_min >= 0),
  updated_at timestamptz not null default now()
);

-- ES and GS are seeded with the same 10:00 start the app has always used; the biometric report
-- itself schedules both shifts to finish at 19:30 and has no late-in rule. Edit here if they differ.
insert into public.shift_rules (shift_code, start_time, grace_min) values
  ('ES', '10:00', 15),
  ('GS', '10:00', 15),
  ('DR', '10:00', 15)
on conflict (shift_code) do nothing;

-- ---------------------------------------------------------------------------
-- The KRA parameters each role is rated on, with weights (sum to 1 per role)
-- ---------------------------------------------------------------------------
create table if not exists public.kra_parameters (
  role_group text not null check (role_group in ('supervisor', 'designer', 'ea')),
  name text not null,
  weight numeric(5, 4) not null check (weight > 0 and weight <= 1),
  sort int not null,
  primary key (role_group, name)
);

insert into public.kra_parameters (role_group, name, weight, sort) values
  ('supervisor', 'Site Execution & Quality Control',          0.20, 1),
  ('supervisor', 'Project Timeline Adherence',                0.20, 2),
  ('supervisor', 'Team Management & Manpower Planning',       0.15, 3),
  ('supervisor', 'Client Coordination & Satisfaction',        0.15, 4),
  ('supervisor', 'Material & Vendor Management',              0.15, 5),
  ('supervisor', 'Safety & Site Compliance',                  0.10, 6),
  ('supervisor', 'Cost & Budget Control',                     0.05, 7),
  ('designer',   'Design Quality & Creativity',               0.25, 1),
  ('designer',   'Client Satisfaction & Feedback',            0.20, 2),
  ('designer',   'Timeline & Deadline Adherence',             0.20, 3),
  ('designer',   'Revision Efficiency (Rework Ratio)',        0.15, 4),
  ('designer',   'Technical / Drawing Accuracy',              0.10, 5),
  ('designer',   'Site Problem-Solving Skills',               0.10, 6),
  ('ea',         'Calendar & Scheduling Management',          0.20, 1),
  ('ea',         'Communication & Correspondence Handling',   0.20, 2),
  ('ea',         'Documentation & Filing Accuracy',           0.15, 3),
  ('ea',         'Task Follow-up & Coordination',             0.20, 4),
  ('ea',         'Confidentiality & Discretion',              0.15, 5),
  ('ea',         'Meeting & Travel Coordination',             0.10, 6)
on conflict (role_group, name) do nothing;

-- ---------------------------------------------------------------------------
-- A finalized month is frozen: scores are no longer recomputed
-- ---------------------------------------------------------------------------
create table if not exists public.month_locks (
  month_key text primary key,
  finalized_at timestamptz not null default now(),
  finalized_by text not null
);

-- ---------------------------------------------------------------------------
-- Director ratings: a blank rating means "not rated yet", which is different from a real 0
-- ---------------------------------------------------------------------------
alter table public.monthly_director_rating_details alter column rating_1_to_5 drop not null;

-- ---------------------------------------------------------------------------
-- Lock the new tables to the service role, and add a private bucket for the report-card PDFs
-- ---------------------------------------------------------------------------
alter table public.shift_rules enable row level security;
alter table public.kra_parameters enable row level security;
alter table public.month_locks enable row level security;
revoke all on public.shift_rules, public.kra_parameters, public.month_locks from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('report-cards', 'report-cards', false)
on conflict (id) do nothing;

-- Latest audit per month is looked up by received time.
create index if not exists rdash_ingests_received_idx on public.rdash_ingests (received_at desc);
