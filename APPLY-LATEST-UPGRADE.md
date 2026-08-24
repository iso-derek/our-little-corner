# Apply the latest Princess + Frog upgrade

The website code is ready. Complete this database step before relying on the new private-photo protection.

## Run the security upgrade

1. Open your `our-little-corner` project in Supabase.
2. Open **SQL Editor**.
3. Select **New query**.
4. Open `supabase-security-hardening.sql` in this website folder.
5. Copy the entire file into the editor.
6. Select **Run**.
7. `Success. No rows returned` is the expected result.

This keeps the shared database and newly uploaded photos available only to the two linked profiles. It also prevents either browser from changing its assigned Frog or Princess identity.

## Publish

After the SQL succeeds, run these commands in PowerShell:

```powershell
git -C "C:\Users\derek\Documents\Codex\2026-06-26\files-mentioned-by-the-user-i\outputs" add .
git -C "C:\Users\derek\Documents\Codex\2026-06-26\files-mentioned-by-the-user-i\outputs" commit -m "Add couple hub, movie shelf, date planner, and security upgrades"
git -C "C:\Users\derek\Documents\Codex\2026-06-26\files-mentioned-by-the-user-i\outputs" push origin main
```

The live GitHub Pages link stays the same after publishing.
