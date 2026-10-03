-- Coordination ratings from the WhatsApp-group review (Decorlab_Coordination_Final_Scores.xlsx).
-- Used as the Coordination score for designers: overall / 5 x 100. Judgement from chat text only.
create table if not exists public.chat_coordination (
  month_key text not null,
  employee_id text not null references public.employees (id),
  overall numeric not null check (overall between 1 and 5),
  criteria jsonb not null default '{}'::jsonb,
  evidence text not null default '',
  comment text not null default '',
  period text not null default '',
  created_at timestamptz not null default now(),
  primary key (month_key, employee_id)
);
alter table public.chat_coordination enable row level security;
revoke all on public.chat_coordination from anon, authenticated;

insert into public.chat_coordination (month_key, employee_id, overall, criteria, evidence, comment, period) values
 ('2026-09', 'DLB-DSG-01', 4.7, '{"Respond":4.5,"Clarity":5,"Follow-through":4.5,"Escalation":5,"Process":4.5}', 'High',
  'Numbered pending-approval lists; chased AC-134 door approval 5 times; seven drawings turned round in ~3 hours (23 Sep). Gap: Shruti''s 29 Sep grill request unanswered.', 'September 2026'),
 ('2026-09', 'DLB-DSG-03', 4.0, '{"Respond":3.5,"Clarity":4.5,"Follow-through":4.5,"Escalation":3,"Process":4.5}', 'Medium',
  '7 drawing drops, each named by project, revision and date. Gap: no change notes, no blockers raised, ''will be late'' with no ETA (10 Sep).', 'September 2026'),
 ('2026-09', 'DLB-DSG-02', 3.7, '{"Respond":3.5,"Clarity":3.5,"Follow-through":4,"Escalation":4,"Process":3.5}', 'Medium',
  'Tags approver on RDash uploads; asked which group before sending (29 Sep). Gap: SS Alam client could not see files (16 Sep); no handover on 22/24 Sep.', 'September 2026'),
 ('2026-09', 'DLB-DSG-04', 3.5, '{"Respond":3.5,"Clarity":3,"Follow-through":3.5,"Escalation":3,"Process":4.5}', 'Low',
  'Mandir 3D options delivered (13 Sep); file sent in ~35 min (3 Sep). Gap: S S Alam assignment got only ''Ok'', no ETA; only 9 messages all month.', 'September 2026')
on conflict (month_key, employee_id) do nothing;
