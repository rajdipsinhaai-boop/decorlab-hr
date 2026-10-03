-- Keep every earlier version of the records that feed the year-end averages. Whenever a row is
-- updated or deleted (a recalculation, a re-upload, an edited rating), its previous contents are
-- copied here first. Nothing in this table is ever updated or deleted by the app.
create table if not exists public.record_history (
  id bigint generated always as identity primary key,
  table_name text not null,
  op text not null check (op in ('UPDATE', 'DELETE')),
  old_row jsonb not null,
  changed_at timestamptz not null default now()
);
create index if not exists record_history_table_idx on public.record_history (table_name, changed_at);
alter table public.record_history enable row level security;
revoke all on public.record_history from anon, authenticated;

create or replace function public.keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- an update that changes nothing (e.g. a recompute with the same numbers) is not worth a copy
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;
  insert into public.record_history (table_name, op, old_row) values (tg_table_name, tg_op, to_jsonb(old));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['monthly_scores', 'monthly_director_rating_details', 'monthly_director_ratings',
                           'attendance_records', 'month_locks', 'employees']
  loop
    execute format('drop trigger if exists keep_history on public.%I', t);
    execute format('create trigger keep_history before update or delete on public.%I
                    for each row execute function public.keep_history()', t);
  end loop;
end $$;
