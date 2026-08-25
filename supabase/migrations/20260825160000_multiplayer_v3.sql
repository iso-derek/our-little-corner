-- Princess + Frog multiplayer backend v3.
-- Applies after 20260824070000_multiplayer_v2.sql.
--
-- This hardening pass makes secrets immutable once locked, prevents one player
-- from silently replacing a live round, and turns rematches/restarts into a
-- two-person request/accept handshake.

alter table public.game_players
  add column if not exists rematch_requested boolean not null default false,
  add column if not exists rematch_requested_at timestamptz;

grant select (rematch_requested, rematch_requested_at)
  on table public.game_players to authenticated;

create or replace function private.game_state_impl(requested_game_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.couple_profiles%rowtype;
  session public.game_sessions%rowtype;
  score jsonb := jsonb_build_object('frog', 0, 'princess', 0);
begin
  select * into profile
  from public.couple_profiles
  where user_id = (select auth.uid())
  limit 1;
  if not found then
    raise exception 'Account is not linked to this corner' using errcode = '42501';
  end if;
  if requested_game_type not in ('number', 'word') then
    raise exception 'Unsupported game type' using errcode = '22023';
  end if;

  select * into session
  from public.game_sessions
  where site_id = profile.site_id and game_type = requested_game_type
  order by created_at desc
  limit 1;

  select jsonb_build_object('frog', frog_wins, 'princess', princess_wins)
  into score
  from public.game_scores
  where site_id = profile.site_id and game_type = requested_game_type;
  score := coalesce(score, jsonb_build_object('frog', 0, 'princess', 0));

  if session.id is null then
    return jsonb_build_object(
      'backendVersion', 3,
      'myRole', profile.role,
      'session', null,
      'players', '[]'::jsonb,
      'moves', '[]'::jsonb,
      'scores', score
    );
  end if;

  return jsonb_build_object(
    'backendVersion', 3,
    'myRole', profile.role,
    'session', (to_jsonb(session) - 'created_by'),
    'players', coalesce((
      select jsonb_agg(to_jsonb(player) - 'user_id' order by player.role)
      from public.game_players player
      where player.session_id = session.id
    ), '[]'::jsonb),
    'moves', coalesce((
      select jsonb_agg(to_jsonb(move) order by move.move_no)
      from public.game_moves move
      where move.session_id = session.id
    ), '[]'::jsonb),
    'scores', score
  );
end;
$$;

create or replace function private.start_game_impl(requested_game_type text, requested_config jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.couple_profiles%rowtype;
  prior_starter text;
  next_starter text;
  normalized_config jsonb;
  new_session_id uuid;
  open_session_id uuid;
  number_range integer;
  word_length integer;
begin
  select * into profile
  from public.couple_profiles
  where user_id = (select auth.uid())
  limit 1;
  if not found then
    raise exception 'Account is not linked to this corner' using errcode = '42501';
  end if;
  if requested_game_type not in ('number', 'word') then
    raise exception 'Unsupported game type' using errcode = '22023';
  end if;

  if requested_game_type = 'number' then
    number_range := coalesce((requested_config->>'range')::integer, 100);
    if number_range not in (50, 100, 500) then
      raise exception 'Number range must be 50, 100, or 500' using errcode = '22023';
    end if;
    normalized_config := jsonb_build_object('range', number_range);
  else
    word_length := coalesce((requested_config->>'length')::integer, 3);
    if word_length not in (3, 4) then
      raise exception 'Word length must be 3 or 4' using errcode = '22023';
    end if;
    normalized_config := jsonb_build_object('length', word_length);
  end if;

  perform pg_advisory_xact_lock(hashtext(profile.site_id || ':' || requested_game_type));

  -- A device that vanished long ago must not block the room forever.
  update public.game_sessions
  set status = 'abandoned', updated_at = now(), revision = revision + 1
  where site_id = profile.site_id
    and game_type = requested_game_type
    and status in ('waiting', 'active')
    and updated_at < now() - interval '24 hours';

  select id into open_session_id
  from public.game_sessions
  where site_id = profile.site_id
    and game_type = requested_game_type
    and status in ('waiting', 'active')
  order by created_at desc
  limit 1;
  if open_session_id is not null then
    raise exception 'A round is already in progress. Request a restart instead.' using errcode = 'P0001';
  end if;

  select starter into prior_starter
  from public.game_sessions
  where site_id = profile.site_id and game_type = requested_game_type
  order by created_at desc
  limit 1;
  next_starter := case
    when prior_starter = 'frog' then 'princess'
    when prior_starter = 'princess' then 'frog'
    else profile.role
  end;

  insert into public.game_sessions (
    site_id, game_type, status, config, starter, current_turn, created_by
  ) values (
    profile.site_id, requested_game_type, 'waiting', normalized_config,
    next_starter, next_starter, (select auth.uid())
  ) returning id into new_session_id;

  insert into public.game_players (
    session_id, role, user_id, rematch_requested, rematch_requested_at
  )
  select new_session_id, roles.role, linked.user_id, false, null
  from (values ('frog'::text), ('princess'::text)) roles(role)
  left join public.couple_profiles linked
    on linked.site_id = profile.site_id and linked.role = roles.role;

  insert into public.game_scores (site_id, game_type)
  values (profile.site_id, requested_game_type)
  on conflict (site_id, game_type) do nothing;

  return private.game_state_impl(requested_game_type);
end;
$$;

create or replace function private.lock_game_secret_impl(requested_session_id uuid, requested_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.couple_profiles%rowtype;
  session public.game_sessions%rowtype;
  normalized_secret text;
  number_value integer;
  expected_length integer;
begin
  select * into profile
  from public.couple_profiles
  where user_id = (select auth.uid())
  limit 1;
  if not found then
    raise exception 'Account is not linked to this corner' using errcode = '42501';
  end if;

  select * into session
  from public.game_sessions
  where id = requested_session_id and site_id = profile.site_id
  for update;
  if not found then
    raise exception 'Game session was not found' using errcode = 'P0002';
  end if;
  if session.status <> 'waiting' or session.winner is not null then
    raise exception 'Secret locking has closed for this round' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from public.game_players player
    where player.session_id = session.id
      and player.role = profile.role
      and player.ready
  ) or exists (
    select 1
    from private.game_secrets secret
    where secret.session_id = session.id
      and secret.role = profile.role
  ) then
    raise exception 'Your secret is already locked and cannot be changed' using errcode = 'P0001';
  end if;

  normalized_secret := upper(trim(coalesce(requested_secret, '')));
  if session.game_type = 'number' then
    if normalized_secret !~ '^[0-9]+$' then
      raise exception 'Secret number is invalid' using errcode = '22023';
    end if;
    number_value := normalized_secret::integer;
    if number_value < 1 or number_value > (session.config->>'range')::integer then
      raise exception 'Secret number is outside the selected range' using errcode = '22023';
    end if;
  else
    expected_length := (session.config->>'length')::integer;
    if normalized_secret !~ '^[A-Z]+$' or length(normalized_secret) <> expected_length then
      raise exception 'Secret word has the wrong length' using errcode = '22023';
    end if;
  end if;

  insert into private.game_secrets (session_id, role, secret_value, locked_at)
  values (session.id, profile.role, normalized_secret, now());

  update public.game_players
  set ready = true,
      user_id = (select auth.uid()),
      locked_at = now(),
      updated_at = now()
  where session_id = session.id and role = profile.role;

  update public.game_sessions
  set status = case
      when (select count(*) from public.game_players player where player.session_id = session.id and player.ready) = 2
        then 'active'
      else 'waiting'
    end,
    revision = revision + 1,
    updated_at = now()
  where id = session.id;

  return private.game_state_impl(session.game_type);
end;
$$;

create or replace function private.request_game_rematch_impl(requested_game_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.couple_profiles%rowtype;
  session public.game_sessions%rowtype;
  requested_count integer;
begin
  select * into profile
  from public.couple_profiles
  where user_id = (select auth.uid())
  limit 1;
  if not found then
    raise exception 'Account is not linked to this corner' using errcode = '42501';
  end if;
  if requested_game_type not in ('number', 'word') then
    raise exception 'Unsupported game type' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(profile.site_id || ':' || requested_game_type));

  select * into session
  from public.game_sessions
  where site_id = profile.site_id and game_type = requested_game_type
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'Start the first round before requesting a rematch' using errcode = 'P0002';
  end if;

  update public.game_players
  set rematch_requested = true,
      rematch_requested_at = coalesce(rematch_requested_at, now()),
      updated_at = now()
  where session_id = session.id and role = profile.role;

  select count(*) into requested_count
  from public.game_players player
  where player.session_id = session.id and player.rematch_requested;

  if requested_count < 2 then
    return private.game_state_impl(requested_game_type);
  end if;

  if session.status in ('waiting', 'active') then
    update public.game_sessions
    set status = 'abandoned', updated_at = now(), revision = revision + 1
    where id = session.id;
  end if;

  return private.start_game_impl(requested_game_type, coalesce(session.config, '{}'::jsonb));
end;
$$;

-- Refresh wrappers so the API schema cache sees the hardened implementations.
create or replace function public.game_get_state(p_game_type text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select private.game_state_impl(p_game_type); $$;

create or replace function public.start_game(p_game_type text, p_config jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.start_game_impl(p_game_type, p_config); $$;

create or replace function public.lock_game_secret(p_session_id uuid, p_secret text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.lock_game_secret_impl(p_session_id, p_secret); $$;

create or replace function public.request_game_rematch(p_game_type text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.request_game_rematch_impl(p_game_type); $$;

revoke all on function private.game_state_impl(text) from public, anon, authenticated;
revoke all on function private.start_game_impl(text, jsonb) from public, anon, authenticated;
revoke all on function private.lock_game_secret_impl(uuid, text) from public, anon, authenticated;
revoke all on function private.request_game_rematch_impl(text) from public, anon, authenticated;
revoke all on function public.game_get_state(text) from public, anon;
revoke all on function public.start_game(text, jsonb) from public, anon;
revoke all on function public.lock_game_secret(uuid, text) from public, anon;
revoke all on function public.request_game_rematch(text) from public, anon;
grant execute on function public.game_get_state(text) to authenticated;
grant execute on function public.start_game(text, jsonb) to authenticated;
grant execute on function public.lock_game_secret(uuid, text) to authenticated;
grant execute on function public.request_game_rematch(text) to authenticated;

comment on column public.game_players.rematch_requested is
  'True after this player requests or accepts a fresh round. Both roles are required.';
comment on function public.request_game_rematch(text) is
  'Records one player rematch request and creates a fresh round only after both roles agree.';
