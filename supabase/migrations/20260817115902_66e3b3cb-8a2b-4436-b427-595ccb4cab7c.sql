CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('decorlab-process-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'decorlab-process-queue');

SELECT cron.schedule(
  'decorlab-process-queue',
  '*/20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--3b834ccc-70bb-4477-a3d2-652f53bb15f5.lovable.app/api/public/cron/process-queue',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_TQuT4Zh3-lqtUqzdjlrXSg_PNmIeze2"}'::jsonb,
    body := '{"source": "pg_cron"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);