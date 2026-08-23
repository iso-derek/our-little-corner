-- Princess + Frog authenticated upgrade
-- Run this after supabase-setup.sql and before publishing the account-enabled site.

create table if not exists public.couple_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  site_id text not null,
  role text not null check (role in ('frog', 'princess')),
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (site_id, role)
);

alter table public.couple_profiles enable row level security;

create or replace function public.is_corner_member(target_site_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.couple_profiles
    where user_id = auth.uid()
      and site_id = target_site_id
  );
$$;

revoke all on function public.is_corner_member(text) from public;
grant execute on function public.is_corner_member(text) to authenticated;

drop policy if exists "couple_profiles_member_read" on public.couple_profiles;
drop policy if exists "couple_profiles_own_update" on public.couple_profiles;

create policy "couple_profiles_member_read"
on public.couple_profiles for select
to authenticated
using (public.is_corner_member(site_id));

create policy "couple_profiles_own_update"
on public.couple_profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_corner_member(site_id));

-- Replace anonymous shared-data access with authenticated couple-only access.
drop policy if exists "corner_kv_public_read" on public.corner_kv;
drop policy if exists "corner_kv_public_insert" on public.corner_kv;
drop policy if exists "corner_kv_public_update" on public.corner_kv;
drop policy if exists "corner_kv_public_delete" on public.corner_kv;
drop policy if exists "corner_kv_member_read" on public.corner_kv;
drop policy if exists "corner_kv_member_insert" on public.corner_kv;
drop policy if exists "corner_kv_member_update" on public.corner_kv;
drop policy if exists "corner_kv_member_delete" on public.corner_kv;

create policy "corner_kv_member_read"
on public.corner_kv for select
to authenticated
using (public.is_corner_member(site_id));

create policy "corner_kv_member_insert"
on public.corner_kv for insert
to authenticated
with check (public.is_corner_member(site_id));

create policy "corner_kv_member_update"
on public.corner_kv for update
to authenticated
using (public.is_corner_member(site_id))
with check (public.is_corner_member(site_id));

create policy "corner_kv_member_delete"
on public.corner_kv for delete
to authenticated
using (public.is_corner_member(site_id));

create table if not exists public.corner_notifications (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_role text not null check (actor_role in ('frog', 'princess')),
  recipient_role text check (recipient_role in ('frog', 'princess')),
  kind text not null,
  title text not null,
  body text not null,
  url text not null default 'index.html',
  created_at timestamptz not null default now(),
  read_by uuid[] not null default '{}'
);

create index if not exists corner_notifications_site_created_idx
on public.corner_notifications (site_id, created_at desc);

alter table public.corner_notifications enable row level security;

drop policy if exists "corner_notifications_member_read" on public.corner_notifications;
drop policy if exists "corner_notifications_member_insert" on public.corner_notifications;
drop policy if exists "corner_notifications_member_update" on public.corner_notifications;
drop policy if exists "corner_notifications_member_delete" on public.corner_notifications;

create policy "corner_notifications_member_read"
on public.corner_notifications for select
to authenticated
using (public.is_corner_member(site_id));

create policy "corner_notifications_member_insert"
on public.corner_notifications for insert
to authenticated
with check (actor_id = auth.uid() and public.is_corner_member(site_id));

create policy "corner_notifications_member_update"
on public.corner_notifications for update
to authenticated
using (public.is_corner_member(site_id))
with check (public.is_corner_member(site_id));

create policy "corner_notifications_member_delete"
on public.corner_notifications for delete
to authenticated
using (actor_id = auth.uid() and public.is_corner_member(site_id));

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_site_idx
on public.push_subscriptions (site_id, user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own_read" on public.push_subscriptions;
drop policy if exists "push_subscriptions_own_insert" on public.push_subscriptions;
drop policy if exists "push_subscriptions_own_update" on public.push_subscriptions;
drop policy if exists "push_subscriptions_own_delete" on public.push_subscriptions;

create policy "push_subscriptions_own_read"
on public.push_subscriptions for select
to authenticated
using (user_id = auth.uid());

create policy "push_subscriptions_own_insert"
on public.push_subscriptions for insert
to authenticated
with check (user_id = auth.uid() and public.is_corner_member(site_id));

create policy "push_subscriptions_own_update"
on public.push_subscriptions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_corner_member(site_id));

create policy "push_subscriptions_own_delete"
on public.push_subscriptions for delete
to authenticated
using (user_id = auth.uid());

-- Existing photos stay compatible. New uploads require a signed-in member.
drop policy if exists "corner_photos_public_insert" on storage.objects;
drop policy if exists "corner_photos_member_insert" on storage.objects;
drop policy if exists "corner_photos_member_update" on storage.objects;
drop policy if exists "corner_photos_member_delete" on storage.objects;

create policy "corner_photos_member_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'corner-photos'
  and public.is_corner_member((storage.foldername(name))[1])
);

create policy "corner_photos_member_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'corner-photos'
  and public.is_corner_member((storage.foldername(name))[1])
)
with check (
  bucket_id = 'corner-photos'
  and public.is_corner_member((storage.foldername(name))[1])
);

create policy "corner_photos_member_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'corner-photos'
  and public.is_corner_member((storage.foldername(name))[1])
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'corner-media',
  'corner-media',
  false,
  52428800,
  array['audio/webm', 'audio/mp4', 'audio/mpeg', 'video/webm', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "corner_media_member_read" on storage.objects;
drop policy if exists "corner_media_member_insert" on storage.objects;
drop policy if exists "corner_media_member_delete" on storage.objects;

create policy "corner_media_member_read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'corner-media'
  and public.is_corner_member((storage.foldername(name))[1])
);

create policy "corner_media_member_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'corner-media'
  and public.is_corner_member((storage.foldername(name))[1])
);

create policy "corner_media_member_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'corner-media'
  and public.is_corner_member((storage.foldername(name))[1])
);

do $$
begin
  alter publication supabase_realtime add table public.corner_notifications;
exception
  when duplicate_object then null;
end $$;

-- After creating both users in Authentication > Users, replace the email
-- placeholders and run these two statements separately:
--
-- insert into public.couple_profiles (user_id, site_id, role, display_name)
-- select id, 'princess-frog-corner', 'frog', 'Frog'
-- from auth.users where email = 'FROG_EMAIL_HERE'
-- on conflict (site_id, role) do update set user_id = excluded.user_id;
--
-- insert into public.couple_profiles (user_id, site_id, role, display_name)
-- select id, 'princess-frog-corner', 'princess', 'Princess'
-- from auth.users where email = 'PRINCESS_EMAIL_HERE'
-- on conflict (site_id, role) do update set user_id = excluded.user_id;
