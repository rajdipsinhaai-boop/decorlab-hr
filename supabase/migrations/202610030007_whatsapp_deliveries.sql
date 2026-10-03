-- One row per person per month for the WhatsApp report-card send, so nobody is messaged twice.
create table if not exists public.whatsapp_deliveries (
  month_key text not null,
  employee_id text not null references public.employees (id),
  to_number text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  response text,
  sent_at timestamptz not null default now(),
  primary key (month_key, employee_id)
);
alter table public.whatsapp_deliveries enable row level security;
revoke all on public.whatsapp_deliveries from anon, authenticated;
