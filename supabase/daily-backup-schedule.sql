-- Run this once in Supabase SQL Editor after deploying daily-content-backup.
-- Replace the two BACKUP_* placeholders first. The secret must exactly match the
-- BACKUP_CRON_SECRET Edge Function secret.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'BACKUP_SECRET_REPLACE_ME',
  'pf_backup_cron_secret',
  'Authorizes the Princess + Frog daily backup function'
)
where not exists (
  select 1 from vault.decrypted_secrets where name = 'pf_backup_cron_secret'
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'pf-daily-content-backup';

select cron.schedule(
  'pf-daily-content-backup',
  '15 2 * * *',
  $schedule$
  select net.http_post(
    url := 'https://lwtzqfxyfodlzhckkckj.supabase.co/functions/v1/daily-content-backup',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-backup-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'pf_backup_cron_secret'
      )
    ),
    body := jsonb_build_object('source', 'daily-cron')
  );
  $schedule$
);

-- Verification queries:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'pf-daily-content-backup';
-- select * from public.corner_backup_runs order by started_at desc limit 10;
