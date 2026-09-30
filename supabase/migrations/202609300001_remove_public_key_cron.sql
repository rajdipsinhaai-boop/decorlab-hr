-- The old job authenticated with the publishable key, which is public.
-- Re-create it by hand with the CRON_SECRET (do not commit the secret):
--   select cron.schedule('decorlab-process-queue', '*/20 * * * *', $$
--     select extensions.http_post(
--       url := 'https://decorlab-hr.vercel.app/api/public/cron/process-queue',
--       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
--       body := '{"source":"pg_cron"}'::jsonb, timeout_milliseconds := 60000) $$);
select cron.unschedule('decorlab-process-queue')
where exists (select 1 from cron.job where jobname = 'decorlab-process-queue');
