-- Princess + Frog normalized content reliability layer.
-- Run after supabase-auth-upgrade.sql and 20260824070000_multiplayer_v2.sql.

create schema if not exists private;

create table if not exists public.corner_letters (
  site_id text not null,
  id text not null,
  title text not null,
  frog_body text not null default '',
  princess_body text not null default '',
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, id)
);

create table if not exists public.corner_memories (
  site_id text not null,
  id text not null,
  title text not null,
  memory_date text not null default '',
  caption text not null default '',
  photo text not null default '',
  default_src text not null default '',
  asset_key text not null default '',
  featured boolean not null default false,
  rotate boolean not null default false,
  direct_src boolean not null default false,
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, id)
);

create table if not exists public.corner_messages (
  site_id text not null,
  id text not null,
  sender_role text not null check (sender_role in ('frog', 'princess')),
  body text not null,
  sent_at timestamptz not null default now(),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, id)
);

create table if not exists public.corner_dates (
  site_id text not null,
  id text not null,
  title text not null,
  planned_for text not null default '',
  budget text not null default '',
  location text not null default '',
  notes text not null default '',
  added_by_role text not null default 'frog' check (added_by_role in ('frog', 'princess')),
  frog_vote boolean not null default false,
  princess_vote boolean not null default false,
  status text not null default 'idea' check (status in ('idea', 'done')),
  completed_at timestamptz,
  selected_at timestamptz,
  selected_by text check (selected_by in ('frog', 'princess')),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, id)
);

create table if not exists public.corner_date_availability (
  site_id text not null,
  role text not null check (role in ('frog', 'princess')),
  available_at text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, role)
);

create table if not exists public.corner_movies (
  site_id text not null,
  id text not null,
  title text not null,
  collection text not null default 'Our Watchlist',
  collection_rank integer,
  picked_by text not null default 'together' check (picked_by in ('frog', 'princess', 'together')),
  note text not null default '',
  watched boolean not null default false,
  watched_at timestamptz,
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, id)
);

create table if not exists public.corner_ratings (
  site_id text not null,
  movie_id text not null,
  role text not null check (role in ('frog', 'princess')),
  score smallint not null default 0 check (score between 0 and 5),
  review text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, movie_id, role),
  foreign key (site_id, movie_id) references public.corner_movies(site_id, id)
);

create table if not exists public.corner_rituals (
  site_id text not null,
  ritual_day date not null,
  role text not null check (role in ('frog', 'princess')),
  mood text not null,
  answer text not null,
  gratitude text not null,
  submitted_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  deleted_at timestamptz,
  primary key (site_id, ritual_day, role)
);

create table if not exists public.corner_backup_runs (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  object_path text not null,
  row_counts jsonb not null default '{}'::jsonb,
  status text not null check (status in ('running', 'complete', 'failed')),
  error_message text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists corner_letters_active_idx on public.corner_letters (site_id, position) where deleted_at is null;
create index if not exists corner_memories_active_idx on public.corner_memories (site_id, position) where deleted_at is null;
create index if not exists corner_messages_active_idx on public.corner_messages (site_id, sent_at desc) where deleted_at is null;
create index if not exists corner_dates_active_idx on public.corner_dates (site_id, position) where deleted_at is null;
create index if not exists corner_movies_active_idx on public.corner_movies (site_id, position) where deleted_at is null;
create index if not exists corner_rituals_day_idx on public.corner_rituals (site_id, ritual_day desc) where deleted_at is null;
create index if not exists corner_backup_runs_site_idx on public.corner_backup_runs (site_id, started_at desc);

create or replace function private.touch_corner_content()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  new.site_id := old.site_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'corner_letters', 'corner_memories', 'corner_messages', 'corner_dates',
    'corner_date_availability', 'corner_movies', 'corner_ratings', 'corner_rituals'
  ] loop
    execute format('drop trigger if exists %I_touch_revision on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_touch_revision before update on public.%I for each row execute function private.touch_corner_content()',
      table_name,
      table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'corner_letters', 'corner_memories', 'corner_messages', 'corner_dates',
    'corner_date_availability', 'corner_movies', 'corner_ratings', 'corner_rituals'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_update', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_corner_member(site_id))',
      table_name || '_member_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (created_by = (select auth.uid()) and public.is_corner_member(site_id))',
      table_name || '_member_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_corner_member(site_id)) with check (public.is_corner_member(site_id))',
      table_name || '_member_update', table_name
    );
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

-- Ritual answers are deliberately available only through content_snapshot(), which
-- hides the partner answer until both people have submitted for that day.
revoke select on public.corner_rituals from authenticated;

alter table public.corner_backup_runs enable row level security;
revoke all on public.corner_backup_runs from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('corner-backups', 'corner-backups', false, 104857600, array['application/json'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- There are intentionally no browser policies for corner-backups. Only the service
-- role used by the daily backup Edge Function can read or write this bucket.

create or replace function private.content_snapshot_impl(p_site_id text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  result jsonb := '{}'::jsonb;
  piece jsonb;
  viewer_role text;
begin
  select role into viewer_role
  from public.couple_profiles
  where user_id = p_user_id and site_id = p_site_id;
  if viewer_role is null then raise exception 'Account is not linked to this corner'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, '_revision', revision
  ) order by position), '[]'::jsonb)
  into piece from public.corner_letters where site_id = p_site_id and deleted_at is null;
  result := result || jsonb_build_object('pf_letter_categories', piece);

  select coalesce(jsonb_object_agg('openwhen_derek_' || id, to_jsonb(frog_body)), '{}'::jsonb)
  into piece from public.corner_letters where site_id = p_site_id and deleted_at is null;
  result := result || piece;
  select coalesce(jsonb_object_agg('openwhen_princess_' || id, to_jsonb(princess_body)), '{}'::jsonb)
  into piece from public.corner_letters where site_id = p_site_id and deleted_at is null;
  result := result || piece;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'date', memory_date, 'caption', caption,
    'photo', photo, 'defaultSrc', default_src, 'assetKey', asset_key,
    'featured', featured, 'rotate', rotate, 'directSrc', direct_src,
    '_revision', revision
  ) order by position), '[]'::jsonb)
  into piece from public.corner_memories where site_id = p_site_id and deleted_at is null;
  result := result || jsonb_build_object('pf_memory_items', piece);

  select coalesce(jsonb_object_agg('pf_memory_' || id || '_date', to_jsonb(memory_date)), '{}'::jsonb)
  into piece from public.corner_memories where site_id = p_site_id and deleted_at is null;
  result := result || piece;
  select coalesce(jsonb_object_agg('pf_memory_' || id || '_caption', to_jsonb(caption)), '{}'::jsonb)
  into piece from public.corner_memories where site_id = p_site_id and deleted_at is null;
  result := result || piece;
  select coalesce(jsonb_object_agg('pf_memory_' || id || '_photo', to_jsonb(photo)), '{}'::jsonb)
  into piece from public.corner_memories where site_id = p_site_id and deleted_at is null;
  result := result || piece;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'sender', sender_role, 'text', body,
    'createdAt', sent_at, '_revision', revision
  ) order by sent_at desc, position), '[]'::jsonb)
  into piece from public.corner_messages where site_id = p_site_id and deleted_at is null;
  result := result || jsonb_build_object('pf_messages', piece);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'when', d.planned_for, 'budget', d.budget,
    'location', d.location, 'notes', d.notes, 'createdBy', d.added_by_role,
    'createdAt', d.created_at, 'votes', jsonb_build_object('frog', d.frog_vote, 'princess', d.princess_vote),
    'status', d.status, 'completedAt', coalesce(d.completed_at::text, ''), '_revision', d.revision
  ) order by d.position), '[]'::jsonb)
  into piece from public.corner_dates d where d.site_id = p_site_id and d.deleted_at is null;
  result := result || jsonb_build_object('pf_date_ideas', piece);

  select case when d.id is null then 'null'::jsonb else jsonb_build_object(
    'id', d.id, 'selectedAt', d.selected_at, 'selectedBy', d.selected_by
  ) end into piece
  from (select id, selected_at, selected_by from public.corner_dates
        where site_id = p_site_id and deleted_at is null and selected_at is not null
        order by selected_at desc limit 1) d;
  result := result || jsonb_build_object('pf_date_selected', coalesce(piece, 'null'::jsonb));

  select coalesce(jsonb_object_agg('pf_date_availability_' || role, to_jsonb(available_at)), '{}'::jsonb)
  into piece from public.corner_date_availability where site_id = p_site_id and deleted_at is null;
  result := result || piece;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'title', m.title, 'collection', m.collection, 'rank', m.collection_rank,
    'pickedBy', m.picked_by, 'note', m.note, 'watched', m.watched,
    'watchedAt', coalesce(m.watched_at::text, ''),
    'ratings', jsonb_build_object('frog', coalesce(fr.score, 0), 'princess', coalesce(pr.score, 0)),
    'reviews', jsonb_build_object('frog', coalesce(fr.review, ''), 'princess', coalesce(pr.review, '')),
    '_revision', m.revision
  ) order by m.position), '[]'::jsonb)
  into piece
  from public.corner_movies m
  left join public.corner_ratings fr on fr.site_id = m.site_id and fr.movie_id = m.id and fr.role = 'frog' and fr.deleted_at is null
  left join public.corner_ratings pr on pr.site_id = m.site_id and pr.movie_id = m.id and pr.role = 'princess' and pr.deleted_at is null
  where m.site_id = p_site_id and m.deleted_at is null;
  result := result || jsonb_build_object('pf_movie_items', piece);

  with visible_rituals as (
    select r.*
    from public.corner_rituals r
    where r.site_id = p_site_id and r.deleted_at is null
      and (r.role = viewer_role or exists (
        select 1 from public.corner_rituals other
        where other.site_id = r.site_id and other.ritual_day = r.ritual_day
          and other.role <> r.role and other.deleted_at is null
      ))
  )
  select coalesce(jsonb_object_agg(
    'pf_ritual_' || ritual_day::text || '_' || role,
    jsonb_build_object('mood', mood, 'answer', answer, 'gratitude', gratitude,
      'submittedAt', submitted_at, '_revision', revision)
  ), '{}'::jsonb) into piece from visible_rituals;
  result := result || piece;

  select coalesce(jsonb_agg(ritual_day order by ritual_day), '[]'::jsonb)
  into piece from (
    select ritual_day from public.corner_rituals
    where site_id = p_site_id and deleted_at is null
    group by ritual_day having count(distinct role) = 2
  ) completed;
  result := result || jsonb_build_object('pf_ritual_completed_days', piece);

  return result;
end;
$$;

create or replace function public.content_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare profile public.couple_profiles%rowtype;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if profile.user_id is null then raise exception 'Account is not linked to this corner'; end if;
  return private.content_snapshot_impl(profile.site_id, profile.user_id);
end;
$$;

create or replace function private.content_write_impl(
  profile public.couple_profiles,
  p_key text,
  p_value jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  item jsonb;
  item_id text;
  item_ids text[] := array[]::text[];
  item_position integer;
  matches text[];
  target_role text;
  rating_score smallint;
  rating_review text;
begin
  if p_key in ('pf_letter_categories', 'pf_memory_items', 'pf_messages', 'pf_date_ideas', 'pf_movie_items')
     and jsonb_typeof(p_value) <> 'array' then
    raise exception 'Expected an array for %', p_key;
  end if;

  if p_key = 'pf_letter_categories' then
    for item, item_position in select value, ordinality::integer from jsonb_array_elements(p_value) with ordinality loop
      item_id := item->>'id';
      if item_id is null or nullif(trim(item->>'title'), '') is null then continue; end if;
      item_ids := array_append(item_ids, item_id);
      insert into public.corner_letters (site_id, id, title, position, created_by, deleted_at)
      values (profile.site_id, item_id, item->>'title', item_position, profile.user_id, null)
      on conflict (site_id, id) do update set
        title = excluded.title, position = excluded.position, deleted_at = null
      where (corner_letters.title, corner_letters.position, corner_letters.deleted_at)
        is distinct from (excluded.title, excluded.position, null);
    end loop;
    update public.corner_letters set deleted_at = now()
    where site_id = profile.site_id and deleted_at is null and not (id = any(item_ids));
    return true;
  end if;

  matches := regexp_match(p_key, '^openwhen_(derek|princess)_(.+)$');
  if matches is not null then
    target_role := case matches[1] when 'derek' then 'frog' else 'princess' end;
    if target_role <> profile.role then return false; end if;
    if target_role = 'frog' then
      update public.corner_letters set frog_body = coalesce(p_value #>> '{}', '')
      where site_id = profile.site_id and id = matches[2] and deleted_at is null;
    else
      update public.corner_letters set princess_body = coalesce(p_value #>> '{}', '')
      where site_id = profile.site_id and id = matches[2] and deleted_at is null;
    end if;
    return true;
  end if;

  if p_key = 'pf_memory_items' then
    for item, item_position in select value, ordinality::integer from jsonb_array_elements(p_value) with ordinality loop
      item_id := item->>'id';
      if item_id is null or nullif(trim(item->>'title'), '') is null then continue; end if;
      item_ids := array_append(item_ids, item_id);
      insert into public.corner_memories (
        site_id, id, title, memory_date, caption, photo, default_src, asset_key,
        featured, rotate, direct_src, position, created_by, deleted_at
      ) values (
        profile.site_id, item_id, item->>'title', coalesce(item->>'date', ''), coalesce(item->>'caption', ''),
        coalesce(item->>'photo', ''), coalesce(item->>'defaultSrc', ''), coalesce(item->>'assetKey', ''),
        coalesce((item->>'featured')::boolean, false), coalesce((item->>'rotate')::boolean, false),
        coalesce((item->>'directSrc')::boolean, false), item_position, profile.user_id, null
      ) on conflict (site_id, id) do update set
        title = excluded.title, memory_date = excluded.memory_date, caption = excluded.caption,
        photo = excluded.photo, default_src = excluded.default_src, asset_key = excluded.asset_key,
        featured = excluded.featured, rotate = excluded.rotate, direct_src = excluded.direct_src,
        position = excluded.position, deleted_at = null
      where row(corner_memories.title, corner_memories.memory_date, corner_memories.caption,
        corner_memories.photo, corner_memories.default_src, corner_memories.asset_key,
        corner_memories.featured, corner_memories.rotate, corner_memories.direct_src,
        corner_memories.position, corner_memories.deleted_at)
        is distinct from row(excluded.title, excluded.memory_date, excluded.caption,
        excluded.photo, excluded.default_src, excluded.asset_key, excluded.featured,
        excluded.rotate, excluded.direct_src, excluded.position, null);
    end loop;
    update public.corner_memories set deleted_at = now()
    where site_id = profile.site_id and deleted_at is null and not (id = any(item_ids));
    return true;
  end if;

  matches := regexp_match(p_key, '^pf_memory_(.+)_(date|caption|photo)$');
  if matches is not null then
    if matches[2] = 'date' then
      update public.corner_memories set memory_date = coalesce(p_value #>> '{}', '') where site_id = profile.site_id and id = matches[1] and deleted_at is null;
    elsif matches[2] = 'caption' then
      update public.corner_memories set caption = coalesce(p_value #>> '{}', '') where site_id = profile.site_id and id = matches[1] and deleted_at is null;
    else
      update public.corner_memories set photo = coalesce(p_value #>> '{}', '') where site_id = profile.site_id and id = matches[1] and deleted_at is null;
    end if;
    return true;
  end if;

  if p_key = 'pf_messages' then
    for item, item_position in select value, ordinality::integer from jsonb_array_elements(p_value) with ordinality loop
      item_id := item->>'id';
      if item_id is null or nullif(trim(item->>'text'), '') is null then continue; end if;
      item_ids := array_append(item_ids, item_id);
      select sender_role into target_role from public.corner_messages
      where site_id = profile.site_id and id = item_id;
      if target_role is null then target_role := profile.role; end if;
      insert into public.corner_messages (site_id, id, sender_role, body, sent_at, position, created_by, deleted_at)
      values (profile.site_id, item_id, target_role, item->>'text',
        coalesce(nullif(item->>'createdAt', '')::timestamptz, now()), item_position, profile.user_id, null)
      on conflict (site_id, id) do update set
        body = excluded.body, position = excluded.position, deleted_at = null
      where (corner_messages.body, corner_messages.position, corner_messages.deleted_at)
        is distinct from (excluded.body, excluded.position, null);
    end loop;
    update public.corner_messages set deleted_at = now()
    where site_id = profile.site_id and deleted_at is null and not (id = any(item_ids));
    return true;
  end if;

  if p_key = 'pf_date_ideas' then
    for item, item_position in select value, ordinality::integer from jsonb_array_elements(p_value) with ordinality loop
      item_id := item->>'id';
      if item_id is null or nullif(trim(item->>'title'), '') is null then continue; end if;
      item_ids := array_append(item_ids, item_id);
      target_role := coalesce(item->>'createdBy', profile.role);
      if target_role not in ('frog', 'princess') then target_role := profile.role; end if;
      insert into public.corner_dates (
        site_id, id, title, planned_for, budget, location, notes, added_by_role,
        frog_vote, princess_vote, status, completed_at, position, created_by, deleted_at
      ) values (
        profile.site_id, item_id, item->>'title', coalesce(item->>'when', ''), coalesce(item->>'budget', ''),
        coalesce(item->>'location', ''), coalesce(item->>'notes', ''), target_role,
        case when profile.role = 'frog' then coalesce((item->'votes'->>'frog')::boolean, false) else false end,
        case when profile.role = 'princess' then coalesce((item->'votes'->>'princess')::boolean, false) else false end,
        case when item->>'status' = 'done' then 'done' else 'idea' end,
        nullif(item->>'completedAt', '')::timestamptz, item_position, profile.user_id, null
      ) on conflict (site_id, id) do update set
        title = excluded.title, planned_for = excluded.planned_for, budget = excluded.budget,
        location = excluded.location, notes = excluded.notes, added_by_role = excluded.added_by_role,
        frog_vote = case when profile.role = 'frog' then excluded.frog_vote else corner_dates.frog_vote end,
        princess_vote = case when profile.role = 'princess' then excluded.princess_vote else corner_dates.princess_vote end,
        status = excluded.status, completed_at = excluded.completed_at,
        position = excluded.position, deleted_at = null
      where row(corner_dates.title, corner_dates.planned_for, corner_dates.budget,
        corner_dates.location, corner_dates.notes, corner_dates.added_by_role,
        corner_dates.frog_vote, corner_dates.princess_vote, corner_dates.status,
        corner_dates.completed_at, corner_dates.position, corner_dates.deleted_at)
        is distinct from row(excluded.title, excluded.planned_for, excluded.budget,
        excluded.location, excluded.notes, excluded.added_by_role, excluded.frog_vote,
        excluded.princess_vote, excluded.status, excluded.completed_at, excluded.position, null);
    end loop;
    update public.corner_dates set deleted_at = now()
    where site_id = profile.site_id and deleted_at is null and not (id = any(item_ids));
    return true;
  end if;

  if p_key = 'pf_date_selected' then
    update public.corner_dates set selected_at = null, selected_by = null
    where site_id = profile.site_id and selected_at is not null;
    if jsonb_typeof(p_value) = 'object' and nullif(p_value->>'id', '') is not null then
      update public.corner_dates set
        selected_at = coalesce(nullif(p_value->>'selectedAt', '')::timestamptz, now()),
        selected_by = case when p_value->>'selectedBy' in ('frog', 'princess') then p_value->>'selectedBy' else profile.role end
      where site_id = profile.site_id and id = p_value->>'id' and deleted_at is null;
    end if;
    return true;
  end if;

  matches := regexp_match(p_key, '^pf_date_availability_(frog|princess)$');
  if matches is not null then
    if matches[1] <> profile.role then return false; end if;
    insert into public.corner_date_availability (site_id, role, available_at, created_by, deleted_at)
    values (profile.site_id, profile.role, coalesce(p_value #>> '{}', ''), profile.user_id, null)
    on conflict (site_id, role) do update set available_at = excluded.available_at, deleted_at = null
    where (corner_date_availability.available_at, corner_date_availability.deleted_at)
      is distinct from (excluded.available_at, null);
    return true;
  end if;

  if p_key = 'pf_movie_items' then
    for item, item_position in select value, ordinality::integer from jsonb_array_elements(p_value) with ordinality loop
      item_id := item->>'id';
      if item_id is null or nullif(trim(item->>'title'), '') is null then continue; end if;
      item_ids := array_append(item_ids, item_id);
      target_role := coalesce(item->>'pickedBy', 'together');
      if target_role not in ('frog', 'princess', 'together') then target_role := 'together'; end if;
      insert into public.corner_movies (
        site_id, id, title, collection, collection_rank, picked_by, note,
        watched, watched_at, position, created_by, deleted_at
      ) values (
        profile.site_id, item_id, item->>'title', coalesce(nullif(item->>'collection', ''), 'Our Watchlist'),
        nullif(item->>'rank', '')::integer, target_role, coalesce(item->>'note', ''),
        coalesce((item->>'watched')::boolean, false), nullif(item->>'watchedAt', '')::timestamptz,
        item_position, profile.user_id, null
      ) on conflict (site_id, id) do update set
        title = excluded.title, collection = excluded.collection, collection_rank = excluded.collection_rank,
        picked_by = excluded.picked_by, note = excluded.note, watched = excluded.watched,
        watched_at = excluded.watched_at, position = excluded.position, deleted_at = null
      where row(corner_movies.title, corner_movies.collection, corner_movies.collection_rank,
        corner_movies.picked_by, corner_movies.note, corner_movies.watched,
        corner_movies.watched_at, corner_movies.position, corner_movies.deleted_at)
        is distinct from row(excluded.title, excluded.collection, excluded.collection_rank,
        excluded.picked_by, excluded.note, excluded.watched, excluded.watched_at,
        excluded.position, null);

      rating_score := greatest(0, least(5, coalesce((item->'ratings'->>profile.role)::smallint, 0)));
      rating_review := coalesce(item->'reviews'->>profile.role, '');
      insert into public.corner_ratings (site_id, movie_id, role, score, review, created_by, deleted_at)
      values (profile.site_id, item_id, profile.role, rating_score, rating_review, profile.user_id, null)
      on conflict (site_id, movie_id, role) do update set
        score = excluded.score, review = excluded.review, deleted_at = null
      where (corner_ratings.score, corner_ratings.review, corner_ratings.deleted_at)
        is distinct from (excluded.score, excluded.review, null);
    end loop;
    update public.corner_movies set deleted_at = now()
    where site_id = profile.site_id and deleted_at is null and not (id = any(item_ids));
    return true;
  end if;

  matches := regexp_match(p_key, '^pf_ritual_(\d{4}-\d{2}-\d{2})_(frog|princess)$');
  if matches is not null then
    if matches[2] <> profile.role then return false; end if;
    insert into public.corner_rituals (
      site_id, ritual_day, role, mood, answer, gratitude, submitted_at, created_by, deleted_at
    ) values (
      profile.site_id, matches[1]::date, profile.role, coalesce(p_value->>'mood', ''),
      coalesce(p_value->>'answer', ''), coalesce(p_value->>'gratitude', ''),
      coalesce(nullif(p_value->>'submittedAt', '')::timestamptz, now()), profile.user_id, null
    ) on conflict (site_id, ritual_day, role) do update set
      mood = excluded.mood, answer = excluded.answer, gratitude = excluded.gratitude,
      submitted_at = excluded.submitted_at, deleted_at = null
    where row(corner_rituals.mood, corner_rituals.answer, corner_rituals.gratitude,
      corner_rituals.submitted_at, corner_rituals.deleted_at)
      is distinct from row(excluded.mood, excluded.answer, excluded.gratitude,
      excluded.submitted_at, null);
    return true;
  end if;

  -- Completion is derived from two ritual rows and never trusted from the browser.
  if p_key = 'pf_ritual_completed_days' then return true; end if;
  return false;
end;
$$;

create or replace function public.content_write(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare profile public.couple_profiles%rowtype;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if profile.user_id is null then raise exception 'Account is not linked to this corner'; end if;
  if not private.content_write_impl(profile, p_key, p_value) then
    raise exception 'This content key is not writable by this account';
  end if;
  return private.content_snapshot_impl(profile.site_id, profile.user_id);
end;
$$;

create or replace function public.content_recycle_bin()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare profile public.couple_profiles%rowtype;
declare result jsonb;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if profile.user_id is null then raise exception 'Account is not linked to this corner'; end if;
  select coalesce(jsonb_agg(row_data order by deleted_at desc), '[]'::jsonb) into result
  from (
    select jsonb_build_object('kind', 'letter', 'id', id, 'title', title,
      'deletedAt', deleted_at, 'revision', revision) as row_data, deleted_at
    from public.corner_letters where site_id = profile.site_id and deleted_at is not null
    union all
    select jsonb_build_object('kind', 'memory', 'id', id, 'title', title,
      'deletedAt', deleted_at, 'revision', revision) as row_data, deleted_at
    from public.corner_memories where site_id = profile.site_id and deleted_at is not null
  ) deleted_content;
  return result;
end;
$$;

create or replace function public.content_restore(p_kind text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare profile public.couple_profiles%rowtype;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if profile.user_id is null then raise exception 'Account is not linked to this corner'; end if;
  if p_kind = 'letter' then
    update public.corner_letters set deleted_at = null where site_id = profile.site_id and id = p_id and deleted_at is not null;
  elsif p_kind = 'memory' then
    update public.corner_memories set deleted_at = null where site_id = profile.site_id and id = p_id and deleted_at is not null;
  else
    raise exception 'Only letters and memories can be restored here';
  end if;
  return private.content_snapshot_impl(profile.site_id, profile.user_id);
end;
$$;

create or replace function public.content_operations_status()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare profile public.couple_profiles%rowtype;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if profile.user_id is null then raise exception 'Account is not linked to this corner'; end if;
  return jsonb_build_object(
    'activeRows', jsonb_build_object(
      'letters', (select count(*) from public.corner_letters where site_id = profile.site_id and deleted_at is null),
      'memories', (select count(*) from public.corner_memories where site_id = profile.site_id and deleted_at is null),
      'messages', (select count(*) from public.corner_messages where site_id = profile.site_id and deleted_at is null),
      'dates', (select count(*) from public.corner_dates where site_id = profile.site_id and deleted_at is null),
      'movies', (select count(*) from public.corner_movies where site_id = profile.site_id and deleted_at is null),
      'ratings', (select count(*) from public.corner_ratings where site_id = profile.site_id and deleted_at is null),
      'rituals', (select count(*) from public.corner_rituals where site_id = profile.site_id and deleted_at is null)
    ),
    'recycleBin', (
      (select count(*) from public.corner_letters where site_id = profile.site_id and deleted_at is not null) +
      (select count(*) from public.corner_memories where site_id = profile.site_id and deleted_at is not null)
    ),
    'lastBackup', (select jsonb_build_object('status', status, 'path', object_path,
      'startedAt', started_at, 'completedAt', completed_at)
      from public.corner_backup_runs where site_id = profile.site_id order by started_at desc limit 1)
  );
end;
$$;

revoke all on function public.content_snapshot() from public;
revoke all on function public.content_write(text, jsonb) from public;
revoke all on function public.content_recycle_bin() from public;
revoke all on function public.content_restore(text, text) from public;
revoke all on function public.content_operations_status() from public;
grant execute on function public.content_snapshot() to authenticated;
grant execute on function public.content_write(text, jsonb) to authenticated;
grant execute on function public.content_recycle_bin() to authenticated;
grant execute on function public.content_restore(text, text) to authenticated;
grant execute on function public.content_operations_status() to authenticated;

revoke all on function private.content_snapshot_impl(text, uuid) from public, anon, authenticated;
revoke all on function private.content_write_impl(public.couple_profiles, text, jsonb) from public, anon, authenticated;
revoke all on function private.touch_corner_content() from public, anon, authenticated;

-- Preserve original authorship for legacy rows before the compatibility writer
-- starts reconciling complete lists.
insert into public.corner_messages (
  site_id, id, sender_role, body, sent_at, position, created_by
)
select kv.site_id, item.value->>'id', item.value->>'sender', item.value->>'text',
  coalesce(nullif(item.value->>'createdAt', '')::timestamptz, now()),
  item.ordinality::integer, profile.user_id
from (select * from public.corner_kv where key = 'pf_messages' and jsonb_typeof(value) = 'array') kv
cross join lateral jsonb_array_elements(kv.value) with ordinality item(value, ordinality)
join public.couple_profiles profile
  on profile.site_id = kv.site_id and profile.role = item.value->>'sender'
where nullif(item.value->>'id', '') is not null
  and nullif(item.value->>'text', '') is not null
on conflict (site_id, id) do nothing;

insert into public.corner_dates (
  site_id, id, title, planned_for, budget, location, notes, added_by_role,
  frog_vote, princess_vote, status, completed_at, position, created_by
)
select kv.site_id, item.value->>'id', item.value->>'title', coalesce(item.value->>'when', ''),
  coalesce(item.value->>'budget', ''), coalesce(item.value->>'location', ''),
  coalesce(item.value->>'notes', ''), profile.role,
  coalesce((item.value->'votes'->>'frog')::boolean, false),
  coalesce((item.value->'votes'->>'princess')::boolean, false),
  case when item.value->>'status' = 'done' then 'done' else 'idea' end,
  nullif(item.value->>'completedAt', '')::timestamptz,
  item.ordinality::integer, profile.user_id
from (select * from public.corner_kv where key = 'pf_date_ideas' and jsonb_typeof(value) = 'array') kv
cross join lateral jsonb_array_elements(kv.value) with ordinality item(value, ordinality)
join public.couple_profiles profile on profile.site_id = kv.site_id
  and profile.role = case when item.value->>'createdBy' in ('frog', 'princess')
    then item.value->>'createdBy' else 'frog' end
where nullif(item.value->>'id', '') is not null
  and nullif(item.value->>'title', '') is not null
on conflict (site_id, id) do nothing;

-- Migrate every recognized legacy corner_kv value. Running this migration again is
-- safe: unchanged rows do not receive a new revision.
do $$
declare
  profile public.couple_profiles%rowtype;
  legacy record;
begin
  for profile in select * from public.couple_profiles loop
    for legacy in
      select key, value from public.corner_kv
      where site_id = profile.site_id and (
        key in ('pf_letter_categories', 'pf_memory_items', 'pf_messages', 'pf_date_ideas',
          'pf_date_selected', 'pf_movie_items', 'pf_ritual_completed_days')
        or key ~ '^openwhen_(derek|princess)_.+$'
        or key ~ '^pf_memory_.+_(date|caption|photo)$'
        or key ~ '^pf_date_availability_(frog|princess)$'
        or key ~ '^pf_ritual_\d{4}-\d{2}-\d{2}_(frog|princess)$'
      )
    loop
      perform private.content_write_impl(profile, legacy.key, legacy.value);
    end loop;
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'corner_letters', 'corner_memories', 'corner_messages', 'corner_dates',
    'corner_date_availability', 'corner_movies', 'corner_ratings'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
