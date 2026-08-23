# Princess + Frog: Our Little Corner

An account-gated shared editorial website for memories, letters, games, messages, gifts, badges, quotes, love notes, recordings, and notifications. It is a static installable web app hosted on GitHub Pages, with Supabase providing account identity, protected shared records, realtime updates, private media storage, and notification delivery.

## Preview locally

In VS Code, right-click `index.html` and choose **Open with Live Server**. The Codex desktop workspace can also use its bundled Python runtime:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4180
```

Then open `http://127.0.0.1:4180/`. A local server is preferred to opening the HTML files directly because it behaves more like the deployed site.

## Edit the site

- Use the visible `Edit` control on Letters, Memories, Badges, Gifts, Things We Said, and Love Notes.
- Memory items can be added, edited, deleted, and moved up or down while edit mode is open.
- Uploaded memory and gift photos are saved in Supabase Storage.
- The Game Room and Our Chat update through the same shared Supabase project.
- Static page introductions and the 21 June story are edited directly in their HTML files.

## Shared configuration

`supabase-config.js` holds the project URL, browser-safe publishable key, site ID, and shared passcode. Run `supabase-setup.sql` in the Supabase SQL Editor when setting up a new project or applying the included table, policy, realtime, and photo bucket configuration.

The production site uses one permanent Frog account and one permanent Princess account. Follow `ACCOUNT-SETUP.md` before deploying the authenticated upgrade. Localhost keeps the passcode preview unless `localAccountPreview` is enabled.

`supabase-auth-upgrade.sql` changes the original anonymous policies to authenticated couple-only Row Level Security. Do not publish that upgrade until both Auth users and both `couple_profiles` rows exist.

The public Supabase browser key is expected in frontend code. Account passwords, the Supabase service-role key, and the VAPID private key must never be committed.

### Privacy boundary

Supabase Row Level Security protects shared database records and the private `corner-media` recording bucket. GitHub Pages and a public GitHub repository still serve files committed to the project directly, including the current static introductions and bundled photographs. The sign-in screen prevents normal browsing but cannot make committed files secret. Fully private static photos require moving them into private Supabase Storage and removing them from the published repository, or placing the whole site behind an access-control host.

## Phone installation and notifications

`service-worker.js` and `site.webmanifest` make the site installable from supported mobile browsers and preserve the app shell offline. The account panel contains installation and notification controls.

Notification history and in-app realtime alerts work after the database upgrade. Closed-app push additionally requires deployment of `supabase/functions/send-notification` and VAPID secrets; the exact commands are in `ACCOUNT-SETUP.md`.

## Recordings

Open edit mode on Letters to record or upload voice notes. Open edit mode on the Memory Wall to add audio or video memories. Recordings are limited to 50 MB, stored in the private `corner-media` bucket, and displayed through temporary signed URLs.

## Expanded Game Room

The lobby supports invitations, reactions, overall scores, and recent match history. The games are Guess Number, Secret Word, Same Page, Would You Rather, Couple Trivia, Truth or Dare, and Memory Match.

## Publish updates

GitHub Pages serves the `main` branch from the repository root. After reviewing changes:

```powershell
git add .
git commit -m "Update Our Little Corner"
git push origin main
```

The live site is `https://iso-derek.github.io/our-little-corner/`. GitHub Pages may take a few minutes to show a new commit.

## Quality checks

The audit scripts use Playwright from the local Codex runtime:

- `tests/site-audit.cjs` checks all nine pages, forms, shared content, presence, and all three multiplayer games.
- `tests/visual-audit.cjs` checks the flagship pages at 320, 375, 390, 430, 768, 1024, and 1440 pixels.
- `tests/upgrade-audit.cjs` checks invitations, reactions, history, the four added games, and media controls.
- `tests/account-audit.cjs` checks permanent account identity and removal of the preview role selector.
- `tests/pwa-audit.cjs` checks the manifest, service-worker cache, and offline Game Room launch.

The responsive WebP files in `images/optimized/` are generated from the original photographs. Keep the originals when replacing assets, then create 640px and 1200px WebP versions for fast delivery.

Design decisions, references, and the page-by-page visual strategy are documented in `DESIGN_DIRECTION.md`.
