create table if not exists public.monthly_director_ratings (
  id uuid primary key default gen_random_uuid(),
  review_month text not null,
  employee_id text not null,
  employee_name text not null,
  director_rating numeric(5,2) not null default 0 check (director_rating >= 0 and director_rating <= 100),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_month, employee_id)
);

alter table public.monthly_director_ratings enable row level security;

drop policy if exists monthly_director_ratings_admin_select on public.monthly_director_ratings;
drop policy if exists monthly_director_ratings_admin_insert on public.monthly_director_ratings;
drop policy if exists monthly_director_ratings_admin_update on public.monthly_director_ratings;
drop policy if exists monthly_director_ratings_admin_delete on public.monthly_director_ratings;

create policy monthly_director_ratings_admin_select
  on public.monthly_director_ratings for select to authenticated
  using (
    exists (
      select 1 from public.allowed_emails ae
      where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and ae.role = 'admin'
    )
  );

create policy monthly_director_ratings_admin_insert
  on public.monthly_director_ratings for insert to authenticated
  with check (
    exists (
      select 1 from public.allowed_emails ae
      where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and ae.role = 'admin'
    )
  );

create policy monthly_director_ratings_admin_update
  on public.monthly_director_ratings for update to authenticated
  using (
    exists (
      select 1 from public.allowed_emails ae
      where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and ae.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.allowed_emails ae
      where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and ae.role = 'admin'
    )
  );

create policy monthly_director_ratings_admin_delete
  on public.monthly_director_ratings for delete to authenticated
  using (
    exists (
      select 1 from public.allowed_emails ae
      where lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and ae.role = 'admin'
    )
  );
