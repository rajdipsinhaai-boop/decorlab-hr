create table if not exists public.monthly_director_rating_details (
  id uuid primary key default gen_random_uuid(),
  review_month text not null,
  employee_id text not null,
  employee_name text not null,
  role text not null default '',
  kra_parameter text not null,
  weight numeric(8,4),
  rating_1_to_5 numeric(4,2) not null check (rating_1_to_5 >= 0 and rating_1_to_5 <= 5),
  weighted_score numeric(8,4),
  source_tab text not null default '',
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_month, employee_id, kra_parameter)
);

alter table public.monthly_director_rating_details enable row level security;

drop policy if exists monthly_director_rating_details_admin_select on public.monthly_director_rating_details;
drop policy if exists monthly_director_rating_details_admin_insert on public.monthly_director_rating_details;
drop policy if exists monthly_director_rating_details_admin_update on public.monthly_director_rating_details;
drop policy if exists monthly_director_rating_details_admin_delete on public.monthly_director_rating_details;

create policy monthly_director_rating_details_admin_select on public.monthly_director_rating_details for select to authenticated using (exists (select 1 from public.allowed_emails ae where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ae.role = 'admin'));
create policy monthly_director_rating_details_admin_insert on public.monthly_director_rating_details for insert to authenticated with check (exists (select 1 from public.allowed_emails ae where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ae.role = 'admin'));
create policy monthly_director_rating_details_admin_update on public.monthly_director_rating_details for update to authenticated using (exists (select 1 from public.allowed_emails ae where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ae.role = 'admin')) with check (exists (select 1 from public.allowed_emails ae where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ae.role = 'admin'));
create policy monthly_director_rating_details_admin_delete on public.monthly_director_rating_details for delete to authenticated using (exists (select 1 from public.allowed_emails ae where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ae.role = 'admin'));
