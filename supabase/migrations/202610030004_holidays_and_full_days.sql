-- Official holidays: nobody is marked absent and nobody is scored down for them.
create table if not exists public.holidays (
  holiday_date date primary key,
  name text not null default ''
);
alter table public.holidays enable row level security;
revoke all on public.holidays from anon, authenticated;

insert into public.holidays (holiday_date, name) values ('2026-09-18', 'Office holiday')
on conflict (holiday_date) do nothing;

-- Already-imported records: holidays are holidays for everyone...
update public.attendance_records r set status = 'Holiday', updated_at = now()
where r.work_date in (select holiday_date from public.holidays) and r.status <> 'Holiday';

-- ...and a "half day" that worked a full 8h30 or more (late in, stayed on) is a full day.
update public.attendance_records set status = 'Present', updated_at = now()
where status = 'Half Day' and coalesce(work_min, 0) >= 510;
