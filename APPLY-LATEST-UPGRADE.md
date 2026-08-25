# Apply the latest Princess + Frog upgrade

The website automatically falls back to its older shared storage until the new database functions exist. Run the SQL files below in order to activate server-controlled games, normalized content, revision history, and recovery.

## Supabase SQL order

1. Open the `our-little-corner` project in Supabase.
2. Open **SQL Editor** and create a new query for each file.
3. Run `supabase-security-hardening.sql` if you have not already run it.
4. Run `supabase/migrations/20260824070000_multiplayer_v2.sql`.
5. Run `supabase/migrations/20260825160000_multiplayer_v3.sql`.
6. Run `supabase/migrations/20260825080000_content_reliability.sql`.

For each file, paste the complete contents and select **Run**. `Success. No rows returned` is the expected result. Do not paste multiple files into one query tab.

The content migration copies current letters, memories, chat messages, date ideas, movies, ratings, and rituals out of `corner_kv`. It keeps the old values as a temporary rollback copy.

## Daily backups

Follow `DATA-RELIABILITY-SETUP.md` to deploy `daily-content-backup`, add the private `BACKUP_CRON_SECRET`, and schedule the daily job. Never put that secret in this project or GitHub.

## Verify

1. Sign in as Frog and open the Game Room once.
2. Sign in as Princess on a second device.
3. Finish a Number duel, request a rematch, and confirm the fresh round starts only after the other person accepts.
4. Delete a temporary memory and restore it through **Recently deleted**.
5. Rate a movie from each account and confirm both ratings remain visible.
6. Open the account drawer and check the **Private backup** status.

The live GitHub Pages link stays the same after publishing. A hard refresh may be needed once so the new service worker replaces the previous cache.
