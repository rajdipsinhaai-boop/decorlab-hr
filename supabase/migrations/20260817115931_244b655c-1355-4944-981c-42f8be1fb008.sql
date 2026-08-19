DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('decorlab-process-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'decorlab-process-queue');

SELECT cron.schedule(
  'decorlab-process-queue',
  '*/20 * * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://decorlab-hr.vercel.app/api/public/cron/process-queue',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_TQuT4Zh3-lqtUqzdjlrXSg_PNmIeze2"}'::jsonb,
    body := '{"source": "pg_cron"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);