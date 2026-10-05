-- A send to the test number is recorded as 'test' so it never blocks the real send to the person.
alter table public.whatsapp_deliveries drop constraint if exists whatsapp_deliveries_status_check;
alter table public.whatsapp_deliveries
  add constraint whatsapp_deliveries_status_check check (status in ('sent', 'failed', 'test'));
