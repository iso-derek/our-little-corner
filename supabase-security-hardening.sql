-- Princess + Frog security hardening
-- Run once in Supabase SQL Editor after supabase-auth-upgrade.sql.

begin;

alter table public.couple_profiles enable row level security;
alter table public.corner_kv enable row level security;
alter table public.corner_notifications enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on table public.couple_profiles from anon;
revoke all on table public.corner_kv from anon;
revoke all on table public.corner_notifications from anon;
revoke all on table public.push_subscriptions from anon;

grant select, update on table public.couple_profiles to authenticated;
grant select, insert, update, delete on table public.corner_kv to authenticated;
grant select, insert, update, delete on table public.corner_notifications to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

create or replace function public.protect_couple_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and (
    new.user_id is distinct from old.user_id
    or new.site_id is distinct from old.site_id
    or new.role is distinct from old.role
  ) then
    raise exception 'Account identity fields cannot be changed from the website';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_couple_profile_identity on public.couple_profiles;
create trigger protect_couple_profile_identity
before update on public.couple_profiles
for each row execute function public.protect_couple_profile_identity();

create or replace function public.protect_corner_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if row(
    new.id, new.site_id, new.actor_id, new.actor_role, new.recipient_role,
    new.kind, new.title, new.body, new.url, new.created_at
  ) is distinct from row(
    old.id, old.site_id, old.actor_id, old.actor_role, old.recipient_role,
    old.kind, old.title, old.body, old.url, old.created_at
  ) then
    raise exception 'Only notification read status can be changed';
  end if;
  if not (old.read_by <@ new.read_by)
    or not (new.read_by <@ (old.read_by || array[auth.uid()])) then
    raise exception 'A user may only mark a notification as read for themselves';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_corner_notification on public.corner_notifications;
create trigger protect_corner_notification
before update on public.corner_notifications
for each row execute function public.protect_corner_notification();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'corner-photos',
  'corner-photos',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "corner_photos_public_read" on storage.objects;
drop policy if exists "corner_photos_public_insert" on storage.objects;
drop policy if exists "corner_photos_member_read" on storage.objects;
drop policy if exists "corner_photos_member_insert" on storage.objects;
drop policy if exists "corner_photos_member_update" on storage.objects;
drop policy if exists "corner_photos_member_delete" on storage.objects;

create policy "corner_photos_member_read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'corner-photos'
  and public.is_corner_member((storage.foldername(name))[1])
);

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

commit;
