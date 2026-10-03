-- There is no "half day": anyone who attended is Present and their hours are what is graded.
update public.attendance_records set status = 'Present', updated_at = now() where status = 'Half Day';
