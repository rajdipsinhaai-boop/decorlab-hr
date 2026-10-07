-- Probation is 6 months from joining (no week off, no paid leave). Join dates are known to the month only.
update public.employees set join_date = '2026-04-01' where id = 'DLB-SUP-01' and join_date is null; -- Gouranga Panrui
update public.employees set join_date = '2026-06-01' where id = 'DLB-SUP-07' and join_date is null; -- Sukhendu Das
update public.employees set join_date = '2026-06-01' where id = 'DLB-SUP-06' and join_date is null; -- Subhajit Bhawal
