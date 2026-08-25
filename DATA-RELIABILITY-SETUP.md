# Data Reliability Upgrade

This upgrade moves letters, memories, messages, date ideas, movies, ratings, and daily rituals out of `corner_kv` and into individual revisioned rows. The website automatically keeps using the old backend until these steps are complete, so it will not suddenly stop working.

## 1. Install the normalized tables

1. Open Supabase, select **our-little-corner**, then open **SQL Editor**.
2. Create a new query.
3. Open `supabase/migrations/20260825080000_content_reliability.sql` on your computer.
4. Paste the entire file into the query and select **Run**.
5. `Success. No rows returned` is the correct result.

The migration copies the current supported `corner_kv` data into the new tables. It does not delete the old rows, which gives you a rollback copy during the transition.

## 2. Verify the app

1. Sign in on the live website as Frog.
2. Open Movies, Dates, Chat, Letters, and Memories once.
3. Add a temporary memory, delete it, then choose **Recently deleted** and restore it.
4. Rate a movie from Frog's account and confirm Princess can see the score.

The green status beside the account menu should move through **Syncing** and **Saved**. If the migration has not been installed, the app silently remains on legacy storage and the recycle button stays hidden.

## 3. Deploy private daily backups

Generate a long random backup secret in PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

Keep the result private.

1. In Supabase, go to **Edge Functions > Secrets**.
2. Add `BACKUP_CRON_SECRET` and use the random value.
3. Deploy the function from this project folder:

```powershell
npx supabase login
npx supabase link --project-ref lwtzqfxyfodlzhckkckj
npx supabase functions deploy daily-content-backup --no-verify-jwt
```

4. Open `supabase/daily-backup-schedule.sql`.
5. Replace `BACKUP_SECRET_REPLACE_ME` with the same random value.
6. Paste the SQL into Supabase SQL Editor and run it once.

The job runs at 02:15 UTC every day. Backups go to the private `corner-backups` bucket and the function keeps the newest 120 daily files. Neither website account receives direct bucket access.

## 4. Check operations

In SQL Editor:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'pf-daily-content-backup';

select site_id, status, object_path, row_counts, started_at, completed_at, error_message
from public.corner_backup_runs
order by started_at desc
limit 10;
```

A healthy run has `status = complete` and an object path ending in the current date. Failed runs keep their error message for diagnosis.

## What is protected

- Every row has `created_by`, `updated_at`, `revision`, and `deleted_at`.
- Normal browser deletes are soft deletes. Hard delete permission is not granted.
- Deleted letters and memories can be restored from the in-app recycle bin.
- Ritual answers are returned to the partner only after both people submit.
- Each movie rating is written only to the signed-in person's rating row.
- The backup bucket has no browser read or write policies.
