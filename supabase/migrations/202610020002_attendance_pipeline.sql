-- Attendance pipeline: roster, parsed biometric records, a job queue, and monthly scores.
-- Everything here is server-only: RLS is on with no policies, so only the service role
-- (the app server) can read or write. Browsers never touch these tables directly.

-- ---------------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id text primary key,                         -- Employee Master id, e.g. DLB-SUP-01
  name text not null,
  role text not null,
  role_group text not null check (role_group in ('supervisor', 'designer', 'ea')),
  department text not null default '',
  manager text not null default '',
  join_date date,
  status text not null default 'Active',
  cosec_id text unique,                        -- biometric user id, e.g. D100
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Alternative spellings seen in exports (stored normalised: lowercase letters and single spaces).
create table if not exists public.employee_aliases (
  alias_key text primary key,
  employee_id text not null references public.employees (id) on delete cascade,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

-- Biometric ids that are deliberately outside this system (e.g. the driver).
create table if not exists public.attendance_exclusions (
  cosec_id text primary key,
  name text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Uploads and parsed records
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_uploads (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  source_format text,                          -- 'xlsx' | 'pdf' (detected from the file bytes)
  file_sha256 text not null,
  storage_path text,
  period_start date,                           -- read from the report title
  period_end date,
  month_keys text[] not null default '{}',     -- months covered, e.g. {'2026-09'}
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  uploaded_by text not null,
  stats jsonb not null default '{}'::jsonb,    -- counts, warnings, unmatched people
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists attendance_uploads_created_idx on public.attendance_uploads (created_at desc);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  month_key text not null,                     -- 'YYYY-MM' of work_date
  work_date date not null,
  cosec_id text not null,
  employee_id text references public.employees (id) on delete set null, -- null = not mapped yet
  raw_name text not null,
  shift text,
  in_at timestamp,                             -- local wall clock, no timezone
  out_at timestamp,
  in2_at timestamp,
  out2_at timestamp,
  first_half text not null default '',
  second_half text not null default '',
  status text not null check (status in
    ('Present', 'Half Day', 'Incomplete', 'Absent', 'Week Off', 'Holiday', 'Leave', 'Unknown')),
  late_in_min int,
  early_out_min int,
  work_min int,
  manual_entry boolean not null default false,
  reason text,
  upload_id uuid references public.attendance_uploads (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (work_date, cosec_id)                 -- re-uploading a month replaces it, never duplicates it
);
create index if not exists attendance_records_month_employee_idx
  on public.attendance_records (month_key, employee_id);
create index if not exists attendance_records_unmapped_idx
  on public.attendance_records (cosec_id) where employee_id is null;

-- ---------------------------------------------------------------------------
-- Monthly scores (one row per employee per month)
-- ---------------------------------------------------------------------------
create table if not exists public.monthly_scores (
  month_key text not null,
  employee_id text not null references public.employees (id) on delete cascade,
  final_score numeric(5, 2),
  rag text check (rag in ('RED', 'YELLOW', 'GREEN')),
  rank_in_role int,
  overall_rank int,
  is_top3 boolean not null default false,
  breakdown jsonb not null default '[]'::jsonb,
  criteria jsonb not null default '[]'::jsonb,
  note text not null default '',
  details jsonb not null default '{}'::jsonb,  -- audit metrics, DPR days, flags
  source text not null,                        -- 'legacy-sheet' | 'claude-audit'
  updated_at timestamptz not null default now(),
  primary key (month_key, employee_id)
);

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  result jsonb,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists jobs_claim_idx on public.jobs (status, run_after);

-- Atomically takes the next runnable job. FOR UPDATE SKIP LOCKED lets several workers run at once
-- without ever taking the same job. A job whose worker died (locked for longer than p_stale) is
-- handed out again, until it runs out of attempts, when it is marked failed instead.
create or replace function public.claim_job(
  p_worker text,
  p_types text[] default null,
  p_job_id uuid default null,
  p_stale interval default interval '10 minutes'
) returns setof public.jobs
language plpgsql
as $$
begin
  update public.jobs
     set status = 'failed',
         error = coalesce(error, 'Worker stopped before finishing and no attempts remain.'),
         finished_at = now(),
         updated_at = now()
   where status = 'running'
     and locked_at < now() - p_stale
     and attempts >= max_attempts;

  return query
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_by = p_worker,
         updated_at = now()
   where j.id = (
     select c.id
       from public.jobs c
      where (c.status = 'queued' and c.run_after <= now()
             or c.status = 'running' and c.locked_at < now() - p_stale)
        and c.attempts < c.max_attempts
        and (p_types is null or c.type = any (p_types))
        and (p_job_id is null or c.id = p_job_id)
      order by c.run_after, c.created_at
      for update skip locked
      limit 1)
  returning j.*;
end;
$$;

-- Replaces/updates one upload's worth of daily records in a single transaction, so a failure
-- part-way never leaves a half-imported month. Re-importing a month updates rows in place.
create or replace function public.import_attendance_records(p_upload_id uuid, p_rows jsonb)
returns int
language plpgsql
as $$
declare
  n int;
begin
  insert into public.attendance_records as r (
    month_key, work_date, cosec_id, employee_id, raw_name, shift,
    in_at, out_at, in2_at, out2_at, first_half, second_half, status,
    late_in_min, early_out_min, work_min, manual_entry, reason, upload_id, updated_at)
  select
    x.month_key, x.work_date, x.cosec_id, x.employee_id, x.raw_name, x.shift,
    x.in_at, x.out_at, x.in2_at, x.out2_at, coalesce(x.first_half, ''), coalesce(x.second_half, ''), x.status,
    x.late_in_min, x.early_out_min, x.work_min, coalesce(x.manual_entry, false), x.reason, p_upload_id, now()
  from jsonb_to_recordset(p_rows) as x(
    month_key text, work_date date, cosec_id text, employee_id text, raw_name text, shift text,
    in_at timestamp, out_at timestamp, in2_at timestamp, out2_at timestamp,
    first_half text, second_half text, status text,
    late_in_min int, early_out_min int, work_min int, manual_entry boolean, reason text)
  on conflict (work_date, cosec_id) do update set
    month_key = excluded.month_key,
    employee_id = coalesce(excluded.employee_id, r.employee_id),
    raw_name = excluded.raw_name,
    shift = excluded.shift,
    in_at = excluded.in_at,
    out_at = excluded.out_at,
    in2_at = excluded.in2_at,
    out2_at = excluded.out2_at,
    first_half = excluded.first_half,
    second_half = excluded.second_half,
    status = excluded.status,
    late_in_min = excluded.late_in_min,
    early_out_min = excluded.early_out_min,
    work_min = excluded.work_min,
    manual_entry = excluded.manual_entry,
    reason = excluded.reason,
    upload_id = excluded.upload_id,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Which months have anything on file (used to build the dashboard's month list).
create or replace function public.review_months()
returns table (month_key text, has_attendance boolean, has_scores boolean)
language sql
stable
as $$
  select m.month_key, bool_or(m.att) as has_attendance, bool_or(m.sc) as has_scores
    from (
      select a.month_key, true as att, false as sc from public.attendance_records a where a.employee_id is not null
      union all
      select s.month_key, false as att, true as sc from public.monthly_scores s
    ) m
   group by m.month_key
   order by m.month_key desc;
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down to the service role
-- ---------------------------------------------------------------------------
alter table public.employees enable row level security;
alter table public.employee_aliases enable row level security;
alter table public.attendance_exclusions enable row level security;
alter table public.attendance_uploads enable row level security;
alter table public.attendance_records enable row level security;
alter table public.monthly_scores enable row level security;
alter table public.jobs enable row level security;

revoke all on public.employees, public.employee_aliases, public.attendance_exclusions,
              public.attendance_uploads, public.attendance_records, public.monthly_scores,
              public.jobs from anon, authenticated;
revoke all on function public.claim_job(text, text[], uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_job(text, text[], uuid, interval) to service_role;
revoke all on function public.review_months() from public, anon, authenticated;
grant execute on function public.review_months() to service_role;
revoke all on function public.import_attendance_records(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_attendance_records(uuid, jsonb) to service_role;

-- Private bucket for the raw uploaded files (kept so any month can be re-processed).
insert into storage.buckets (id, name, public)
values ('attendance-uploads', 'attendance-uploads', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: roster as of August 2026, with the biometric ids seen in the COSEC reports
-- ---------------------------------------------------------------------------
insert into public.employees (id, name, role, role_group, department, manager, cosec_id) values
  ('DLB-SUP-01', 'Gouranga Panrui',   'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D115'),
  ('DLB-SUP-02', 'Susovan Haldar',    'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D114'),
  ('DLB-SUP-03', 'Sibhu Das',         'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D103'),
  ('DLB-SUP-04', 'Arunava Mallick',   'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D102'),
  ('DLB-SUP-05', 'Ranjan Maity',      'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D100'),
  ('DLB-SUP-06', 'Subhajit Bhawal',   'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D116'),
  ('DLB-SUP-07', 'Sukhendu Das',      'Site Supervisor',         'supervisor', 'Site Operations', 'Operations Head',   'D108'),
  ('DLB-DSG-01', 'Bhavana Agarwal',   'Interior Designer (Head)', 'designer',  'Design Studio',   'Design Head',       'D109'),
  ('DLB-DSG-02', 'Asif Ali Khan',     'Interior Designer (Head)', 'designer',  'Design Studio',   'Design Head',       'D105'),
  ('DLB-DSG-03', 'Shibnath Mondal',   'Interior Designer',       'designer',   'Design Studio',   'Design Head',       'D111'),
  ('DLB-DSG-04', 'Deep Das',          'Interior Designer',       'designer',   'Design Studio',   'Design Head',       'D104'),
  ('DLB-EA-01',  'Priyanka Dalapati', 'Executive Assistant',     'ea',         'Admin & Support', 'Founder / Director', 'D113')
on conflict (id) do nothing;

-- Spellings RDash and the biometric system have used for the same people.
insert into public.employee_aliases (alias_key, employee_id, source) values
  ('sushovan haldar', 'DLB-SUP-02', 'seed'),
  ('gouranga parui',  'DLB-SUP-01', 'seed')
on conflict (alias_key) do nothing;

insert into public.attendance_exclusions (cosec_id, name, reason) values
  ('D112', 'Santosh Kumar Yadav', 'Driver: excluded from the performance system')
on conflict (cosec_id) do nothing;
