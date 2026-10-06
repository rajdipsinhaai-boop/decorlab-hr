-- A day with both an in and an out punch (and hours) is never "absent": fewer hours is a lower hours total.
update public.attendance_records
set status = 'Present', updated_at = now()
where status in ('Absent', 'Unknown')
  and in_at is not null
  and out_at is not null
  and coalesce(work_min, 0) > 0
  and work_date not in (select holiday_date from public.holidays);
