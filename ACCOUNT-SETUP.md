# Activate Frog and Princess Accounts

The website code is ready for two permanent accounts. Complete these Supabase steps before pushing the account-enabled version to GitHub Pages.

> **Privacy note:** account login and Row Level Security protect Supabase records and private recordings. GitHub Pages still publicly serves files committed to the repository, including current bundled photographs and static HTML text. See the privacy boundary in `README.md` before treating the published URL as fully private.

## 1. Upgrade the database security

1. Open the `our-little-corner` project in Supabase.
2. Open **SQL Editor** and create a new query.
3. Paste all of `supabase-auth-upgrade.sql` into the query.
4. Click **Run**.
5. Confirm that Supabase reports `Success. No rows returned`.

This replaces anonymous access with authenticated couple-only policies. It also creates profiles, notification history, push subscriptions, and the private recording bucket.

## 2. Create the two users

1. In Supabase, open **Authentication > Users**.
2. Choose **Add user > Create new user**.
3. Create Frog's account with his email and a private password. Enable **Auto Confirm User**.
4. Create Princess's account with her email and a different private password. Enable **Auto Confirm User**.

Do not put either password in this repository or share it in the SQL editor.

## 3. Permanently assign each role

Return to **SQL Editor** and run these statements after replacing the email placeholders:

```sql
insert into public.couple_profiles (user_id, site_id, role, display_name)
select id, 'princess-frog-corner', 'frog', 'Frog'
from auth.users where email = 'FROG_EMAIL_HERE'
on conflict (site_id, role) do update set user_id = excluded.user_id;

insert into public.couple_profiles (user_id, site_id, role, display_name)
select id, 'princess-frog-corner', 'princess', 'Princess'
from auth.users where email = 'PRINCESS_EMAIL_HERE'
on conflict (site_id, role) do update set user_id = excluded.user_id;
```

Verify the result:

```sql
select role, display_name, user_id from public.couple_profiles;
```

You should see exactly one Frog row and one Princess row.

## 4. Configure password-reset links

In **Authentication > URL Configuration**:

- Set **Site URL** to `https://iso-derek.github.io/our-little-corner/`.
- Add `https://iso-derek.github.io/our-little-corner/**` to **Redirect URLs**.
- Keep `http://127.0.0.1:4180/**` as an additional redirect while testing locally.

## 5. Test the accounts locally

Localhost keeps the existing passcode preview by default. To test the real account screen locally, temporarily change this line in `supabase-config.js`:

```js
localAccountPreview: true
```

Restart the local server, sign in once as Frog, and use a private/incognito window for Princess. Change the value back to `false` after testing so the normal local preview remains convenient.

## 6. Activate closed-app push notifications

In-app notifications work as soon as the account upgrade is complete. Closed-app browser push additionally needs VAPID signing keys and the included Supabase Edge Function.

Generate keys on a computer with Node.js:

```powershell
npx web-push generate-vapid-keys
```

1. Put only the generated **public key** in `supabase-config.js` as `vapidPublicKey`.
2. Never place the private key in the website or GitHub.
3. Install and sign in to the Supabase CLI.
4. From this project folder, run:

```powershell
npx supabase link --project-ref lwtzqfxyfodlzhckkckj
npx supabase secrets set VAPID_PUBLIC_KEY="PUBLIC_KEY" VAPID_PRIVATE_KEY="PRIVATE_KEY" VAPID_SUBJECT="mailto:YOUR_EMAIL"
npx supabase functions deploy send-notification
```

After deployment, each person opens the account panel and selects **Enable notifications** once on each phone.

## 7. Publish

Commit and push only after both profiles have been created. The live site will then use account login instead of the shared passcode and role selector.
