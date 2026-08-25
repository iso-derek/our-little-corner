# Secure Multiplayer Setup

The website code is ready. Run both multiplayer migrations before the live site switches from compatibility games to server-verified multiplayer.

## 1. Open the migration

Open these files on your computer in this order:

`supabase/migrations/20260824070000_multiplayer_v2.sql`

`supabase/migrations/20260825160000_multiplayer_v3.sql`

Select everything and copy it.

## 2. Run it in Supabase

1. Open the **our-little-corner** project in Supabase.
2. Open **SQL Editor** from the left menu.
3. Select **New query**.
4. Paste the complete V2 migration into the editor.
5. Select **Run**.
6. Create a second new query, paste the complete V3 migration, and select **Run** again.
7. `Success. No rows returned` is the correct result for both files.

The migrations create the normalized game tables, private immutable secret vault, server game functions, two-person rematch approval, Realtime permissions, and live table subscriptions. They are safe to run again if you are unsure whether the first run completed.

## 3. Publish the new website files

After the migration succeeds, push the latest `main` branch to GitHub. GitHub Pages normally updates within a few minutes.

## 4. Refresh both phones

1. Close every old Princess + Frog tab on both phones.
2. Open `https://iso-derek.github.io/our-little-corner/game.html`.
3. Sign in to the correct account on each phone.
4. Refresh once. If it was installed as an app, fully close and reopen it.

The Number and Word games will show **Server-verified play** when the new backend is active.

## 5. Quick two-phone test

1. Frog starts a Number duel.
2. Both people lock a different secret number.
3. Only the starting player can guess.
4. After a wrong guess, the turn moves to the other player on both screens.
5. Tap **Request rematch** after a winner. The other player sees **Accept rematch**; only then should a fresh round appear.
6. Repeat with a three-letter Secret Word duel and confirm both players see every guess and its common-letter count.

If the migration has not been run yet, the site deliberately keeps the older games available instead of showing a broken Game Room.
