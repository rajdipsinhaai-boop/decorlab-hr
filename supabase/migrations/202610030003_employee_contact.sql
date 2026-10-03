-- Contact details per employee (source: team contact directory).
alter table public.employees
  add column if not exists phone text,
  add column if not exists email text;

update public.employees e set phone = v.phone, email = v.email
from (values
  ('DLB-DSG-01','+91 9051292971','a.bhavana2002@gmail.com'),
  ('DLB-EA-01', '+91 8769078203','priyankadalapati99@gmail.com'),
  ('DLB-DSG-04','+91 7908344246','himu.hrx6@gmail.com'),
  ('DLB-DSG-02','+91 8017200790','alikhanasif006@gmail.com'),
  ('DLB-DSG-03','+91 6295979831','shibnathm122@gmail.com'),
  ('DLB-SUP-05','+91 9836417658','ranjanmaity840@gmail.com'),
  ('DLB-SUP-02','+91 9681665152','susovan.h89@gmail.com'),
  ('DLB-SUP-04','+91 9836030676','arunavamallick012@gmail.com'),
  ('DLB-SUP-03','+91 9123381560','shibu8017@gmail.com'),
  ('DLB-SUP-01','+91 8391852806','paruigouranga64@gmail.com'),
  ('DLB-SUP-07','+91 9836599191','dasgaurab292002@gmail.com'),
  ('DLB-SUP-06','+91 9804589576','bhawal.subhajit@gmail.com')
) as v(id, phone, email) where e.id = v.id;
