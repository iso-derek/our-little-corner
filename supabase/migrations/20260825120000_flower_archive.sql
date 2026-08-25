-- Shared Flower Archive with row-level access and soft-delete history.
-- Run after 20260825080000_content_reliability.sql.

create table if not exists public.corner_flower_gifts (
  site_id text not null,
  id text not null,
  title text not null,
  given_on text not null default '',
  occasion text not null default 'Just because',
  flower_types text not null default 'Mixed blooms',
  palette text not null default 'Mixed',
  note text not null default '',
  photo text not null default '',
  created_by_role text not null default 'frog' check (created_by_role in ('frog', 'princess')),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, id)
);

create index if not exists corner_flower_gifts_active_idx
  on public.corner_flower_gifts (site_id, position)
  where deleted_at is null;

drop trigger if exists corner_flower_gifts_touch_revision on public.corner_flower_gifts;
create trigger corner_flower_gifts_touch_revision
before update on public.corner_flower_gifts
for each row execute function private.touch_corner_content();

alter table public.corner_flower_gifts enable row level security;
drop policy if exists corner_flower_gifts_member_read on public.corner_flower_gifts;
create policy corner_flower_gifts_member_read
on public.corner_flower_gifts for select to authenticated
using (public.is_corner_member(site_id));

revoke insert, update, delete on public.corner_flower_gifts from anon, authenticated;
grant select on public.corner_flower_gifts to authenticated;

create or replace function private.flower_archive_json(p_site_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'title', title,
    'date', given_on,
    'occasion', occasion,
    'flowerTypes', flower_types,
    'palette', palette,
    'note', note,
    'photo', photo,
    'createdBy', created_by_role,
    'createdAt', created_at,
    'updatedAt', updated_at,
    '_revision', revision
  ) order by position, created_at desc), '[]'::jsonb)
  from public.corner_flower_gifts
  where site_id = p_site_id and deleted_at is null;
$$;

create or replace function public.flower_archive_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  profile public.couple_profiles%rowtype;
begin
  select * into profile
  from public.couple_profiles
  where user_id = (select auth.uid())
  limit 1;
  if profile.user_id is null then
    raise exception 'Account is not linked to this corner';
  end if;
  return private.flower_archive_json(profile.site_id);
end;
$$;

create or replace function public.flower_archive_replace(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  profile public.couple_profiles%rowtype;
  item jsonb;
  item_id text;
  item_ids text[] := array[]::text[];
  item_position integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Flower archive must be a JSON array';
  end if;

  select * into profile
  from public.couple_profiles
  where user_id = (select auth.uid())
  limit 1;
  if profile.user_id is null then
    raise exception 'Account is not linked to this corner';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := nullif(trim(item->>'id'), '');
    if item_id is null or nullif(trim(item->>'title'), '') is null then
      raise exception 'Each bouquet needs an id and title';
    end if;
    if item_id = any(item_ids) then
      raise exception 'Duplicate bouquet id: %', item_id;
    end if;
    item_ids := array_append(item_ids, item_id);

    insert into public.corner_flower_gifts (
      site_id, id, title, given_on, occasion, flower_types, palette, note, photo,
      created_by_role, position, created_by, created_at
    ) values (
      profile.site_id,
      item_id,
      left(trim(item->>'title'), 100),
      left(coalesce(item->>'date', ''), 40),
      left(coalesce(nullif(trim(item->>'occasion'), ''), 'Just because'), 80),
      left(coalesce(nullif(trim(item->>'flowerTypes'), ''), 'Mixed blooms'), 180),
      left(coalesce(nullif(trim(item->>'palette'), ''), 'Mixed'), 40),
      left(coalesce(item->>'note', ''), 600),
      left(coalesce(item->>'photo', ''), 1600),
      case when item->>'createdBy' = 'princess' then 'princess' else 'frog' end,
      item_position,
      profile.user_id,
      coalesce(nullif(item->>'createdAt', '')::timestamptz, now())
    )
    on conflict (site_id, id) do update set
      title = excluded.title,
      given_on = excluded.given_on,
      occasion = excluded.occasion,
      flower_types = excluded.flower_types,
      palette = excluded.palette,
      note = excluded.note,
      photo = excluded.photo,
      position = excluded.position,
      deleted_at = null;

    item_position := item_position + 1;
  end loop;

  update public.corner_flower_gifts
  set deleted_at = now()
  where site_id = profile.site_id
    and deleted_at is null
    and not (id = any(item_ids));

  return private.flower_archive_json(profile.site_id);
end;
$$;

revoke all on function public.flower_archive_snapshot() from public;
revoke all on function public.flower_archive_replace(jsonb) from public;
grant execute on function public.flower_archive_snapshot() to authenticated;
grant execute on function public.flower_archive_replace(jsonb) to authenticated;
revoke all on function private.flower_archive_json(text) from public, anon, authenticated;

-- Preserve any Flower Archive entries created through the compatibility store
-- before this migration is installed.
with legacy_rows as (
  select
    kv.site_id,
    item.value,
    item.ordinality::integer - 1 as position,
    (
      select profile.user_id
      from public.couple_profiles profile
      where profile.site_id = kv.site_id
      order by (profile.role = case when item.value->>'createdBy' = 'princess' then 'princess' else 'frog' end) desc
      limit 1
    ) as actor_id
  from public.corner_kv kv
  cross join lateral jsonb_array_elements(kv.value) with ordinality item(value, ordinality)
  where kv.key = 'pf_flower_gifts' and jsonb_typeof(kv.value) = 'array'
)
insert into public.corner_flower_gifts (
  site_id, id, title, given_on, occasion, flower_types, palette, note, photo,
  created_by_role, position, created_by, created_at
)
select
  site_id,
  value->>'id',
  value->>'title',
  coalesce(value->>'date', ''),
  coalesce(nullif(value->>'occasion', ''), 'Just because'),
  coalesce(nullif(value->>'flowerTypes', ''), 'Mixed blooms'),
  coalesce(nullif(value->>'palette', ''), 'Mixed'),
  coalesce(value->>'note', ''),
  coalesce(value->>'photo', ''),
  case when value->>'createdBy' = 'princess' then 'princess' else 'frog' end,
  position,
  actor_id,
  coalesce(nullif(value->>'createdAt', '')::timestamptz, now())
from legacy_rows
where actor_id is not null
  and nullif(value->>'id', '') is not null
  and nullif(value->>'title', '') is not null
on conflict (site_id, id) do nothing;

do $$
begin
  alter publication supabase_realtime add table public.corner_flower_gifts;
exception when duplicate_object then null;
end $$;

