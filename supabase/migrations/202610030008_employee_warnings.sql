-- Each employee gets 2 warnings per calendar year. A month with fewer visible updates than days
-- present uses one (and leaves attendance alone); once both are used, attendance is reduced instead.
create table if not exists public.employee_warnings (
  employee_id text not null references public.employees (id),
  month_key text not null,
  year int not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (employee_id, month_key)
);
create index if not exists employee_warnings_year_idx on public.employee_warnings (year, employee_id);
alter table public.employee_warnings enable row level security;
revoke all on public.employee_warnings from anon, authenticated;
