-- Princess + Frog multiplayer backend v2.
-- Run once after supabase-auth-upgrade.sql and supabase-security-hardening.sql.

create extension if not exists pgcrypto;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  game_type text not null check (game_type in ('number', 'word')),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'abandoned')),
  config jsonb not null default '{}'::jsonb,
  starter text not null check (starter in ('frog', 'princess')),
  current_turn text not null check (current_turn in ('frog', 'princess')),
  winner text check (winner in ('frog', 'princess')),
  revision bigint not null default 1,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists game_sessions_one_open_round
  on public.game_sessions (site_id, game_type)
  where status in ('waiting', 'active');
create index if not exists game_sessions_site_history
  on public.game_sessions (site_id, game_type, created_at desc);

create table if not exists public.game_players (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  role text not null check (role in ('frog', 'princess')),
  user_id uuid references auth.users(id) on delete set null,
  ready boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (session_id, role)
);

create index if not exists game_players_user
  on public.game_players (user_id, session_id);

create table if not exists public.game_moves (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  move_no integer not null check (move_no > 0),
  player_role text not null check (player_role in ('frog', 'princess')),
  guess text not null,
  clue text not null,
  common_letters integer check (common_letters is null or common_letters >= 0),
  correct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, move_no)
);

create index if not exists game_moves_session_order
  on public.game_moves (session_id, move_no);

create table if not exists public.game_scores (
  site_id text not null,
  game_type text not null check (game_type in ('number', 'word')),
  frog_wins integer not null default 0 check (frog_wins >= 0),
  princess_wins integer not null default 0 check (princess_wins >= 0),
  updated_at timestamptz not null default now(),
  primary key (site_id, game_type)
);

create table if not exists private.game_secrets (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  role text not null check (role in ('frog', 'princess')),
  secret_value text not null,
  locked_at timestamptz not null default now(),
  primary key (session_id, role)
);

alter table public.game_sessions enable row level security;
alter table public.game_players enable row level security;
alter table public.game_moves enable row level security;
alter table public.game_scores enable row level security;
alter table private.game_secrets enable row level security;

revoke all on table public.game_sessions from anon, authenticated;
revoke all on table public.game_players from anon, authenticated;
revoke all on table public.game_moves from anon, authenticated;
revoke all on table public.game_scores from anon, authenticated;
revoke all on table private.game_secrets from public, anon, authenticated;

grant select (id, site_id, game_type, status, config, starter, current_turn, winner, revision, created_at, updated_at, finished_at)
  on table public.game_sessions to authenticated;
grant select (session_id, role, ready, attempts, locked_at, updated_at)
  on table public.game_players to authenticated;
grant select on table public.game_moves to authenticated;
grant select on table public.game_scores to authenticated;

create or replace function private.is_corner_member(target_site_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.couple_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.site_id = target_site_id
  );
$$;

revoke all on function private.is_corner_member(text) from public, anon;
grant execute on function private.is_corner_member(text) to authenticated;

drop policy if exists "game_sessions_member_read" on public.game_sessions;
create policy "game_sessions_member_read"
on public.game_sessions for select to authenticated
using (private.is_corner_member(site_id));

drop policy if exists "game_players_member_read" on public.game_players;
create policy "game_players_member_read"
on public.game_players for select to authenticated
using (
  exists (
    select 1 from public.game_sessions session
    where session.id = game_players.session_id
      and private.is_corner_member(session.site_id)
  )
);

drop policy if exists "game_moves_member_read" on public.game_moves;
create policy "game_moves_member_read"
on public.game_moves for select to authenticated
using (
  exists (
    select 1 from public.game_sessions session
    where session.id = game_moves.session_id
      and private.is_corner_member(session.site_id)
  )
);

drop policy if exists "game_scores_member_read" on public.game_scores;
create policy "game_scores_member_read"
on public.game_scores for select to authenticated
using (private.is_corner_member(site_id));

create or replace function private.common_letter_count(candidate text, secret text)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  counts integer[] := array_fill(0, array[26]);
  index_value integer;
  total integer := 0;
  position integer;
begin
  if candidate is null or secret is null then return 0; end if;
  for position in 1..length(secret) loop
    index_value := ascii(substr(secret, position, 1)) - 64;
    if index_value between 1 and 26 then
      counts[index_value] := counts[index_value] + 1;
    end if;
  end loop;
  for position in 1..length(candidate) loop
    index_value := ascii(substr(candidate, position, 1)) - 64;
    if index_value between 1 and 26 and counts[index_value] > 0 then
      total := total + 1;
      counts[index_value] := counts[index_value] - 1;
    end if;
  end loop;
  return total;
end;
$$;

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
      'backendVersion', 2,
      'myRole', profile.role,
      'session', null,
      'players', '[]'::jsonb,
      'moves', '[]'::jsonb,
      'scores', score
    );
  end if;

  return jsonb_build_object(
    'backendVersion', 2,
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

  update public.game_sessions
  set status = 'abandoned', updated_at = now(), revision = revision + 1
  where site_id = profile.site_id
    and game_type = requested_game_type
    and status in ('waiting', 'active');

  insert into public.game_sessions (
    site_id, game_type, status, config, starter, current_turn, created_by
  ) values (
    profile.site_id, requested_game_type, 'waiting', normalized_config,
    next_starter, next_starter, (select auth.uid())
  ) returning id into new_session_id;

  insert into public.game_players (session_id, role, user_id)
  select new_session_id, roles.role, linked.user_id
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
  if not found then raise exception 'Game session was not found' using errcode = 'P0002'; end if;
  if session.status not in ('waiting', 'active') or session.winner is not null then
    raise exception 'This round is already over' using errcode = 'P0001';
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
  values (session.id, profile.role, normalized_secret, now())
  on conflict (session_id, role) do update
  set secret_value = excluded.secret_value, locked_at = excluded.locked_at;

  update public.game_players
  set ready = true, user_id = (select auth.uid()), locked_at = now(), updated_at = now()
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

create or replace function private.submit_game_guess_impl(requested_session_id uuid, requested_guess text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.couple_profiles%rowtype;
  session public.game_sessions%rowtype;
  opponent_role text;
  target_secret text;
  normalized_guess text;
  clue_value text;
  common_value integer := null;
  correct_value boolean := false;
  next_move integer;
  attempt_count integer;
  number_guess integer;
  number_target integer;
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
  if not found then raise exception 'Game session was not found' using errcode = 'P0002'; end if;
  if session.status <> 'active' or session.winner is not null then
    raise exception 'Both players must lock their secrets before guessing' using errcode = 'P0001';
  end if;
  if session.current_turn <> profile.role then
    raise exception 'It is not your turn' using errcode = 'P0001';
  end if;

  opponent_role := case when profile.role = 'frog' then 'princess' else 'frog' end;
  select secret_value into target_secret
  from private.game_secrets
  where session_id = session.id and role = opponent_role;
  if target_secret is null then
    raise exception 'Your partner has not locked a secret yet' using errcode = 'P0001';
  end if;

  normalized_guess := upper(trim(coalesce(requested_guess, '')));
  if session.game_type = 'number' then
    if normalized_guess !~ '^[0-9]+$' then raise exception 'Guess is invalid' using errcode = '22023'; end if;
    number_guess := normalized_guess::integer;
    number_target := target_secret::integer;
    if number_guess < 1 or number_guess > (session.config->>'range')::integer then
      raise exception 'Guess is outside the selected range' using errcode = '22023';
    end if;
    correct_value := number_guess = number_target;
    clue_value := case
      when correct_value then 'Correct'
      when number_guess < number_target then 'Too low - go higher'
      else 'Too high - go lower'
    end;
  else
    expected_length := (session.config->>'length')::integer;
    if normalized_guess !~ '^[A-Z]+$' or length(normalized_guess) <> expected_length then
      raise exception 'Guess has the wrong word length' using errcode = '22023';
    end if;
    common_value := private.common_letter_count(normalized_guess, target_secret);
    correct_value := normalized_guess = target_secret;
    clue_value := case
      when correct_value then 'Correct'
      else common_value::text || ' of ' || expected_length || ' letters in common'
    end;
  end if;

  update public.game_players
  set attempts = attempts + 1, updated_at = now()
  where session_id = session.id and role = profile.role
  returning attempts into attempt_count;

  select coalesce(max(move_no), 0) + 1 into next_move
  from public.game_moves where session_id = session.id;

  insert into public.game_moves (
    session_id, move_no, player_role, guess, clue, common_letters, correct
  ) values (
    session.id, next_move, profile.role, normalized_guess, clue_value, common_value, correct_value
  );

  update public.game_sessions
  set status = case when correct_value then 'finished' else 'active' end,
      winner = case when correct_value then profile.role else null end,
      current_turn = case when correct_value then profile.role else opponent_role end,
      finished_at = case when correct_value then now() else null end,
      revision = revision + 1,
      updated_at = now()
  where id = session.id;

  if correct_value then
    insert into public.game_scores (site_id, game_type, frog_wins, princess_wins, updated_at)
    values (
      profile.site_id,
      session.game_type,
      case when profile.role = 'frog' then 1 else 0 end,
      case when profile.role = 'princess' then 1 else 0 end,
      now()
    )
    on conflict (site_id, game_type) do update
    set frog_wins = public.game_scores.frog_wins + case when profile.role = 'frog' then 1 else 0 end,
        princess_wins = public.game_scores.princess_wins + case when profile.role = 'princess' then 1 else 0 end,
        updated_at = now();
  end if;

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
  prior_config jsonb;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if not found then raise exception 'Account is not linked to this corner' using errcode = '42501'; end if;
  select config into prior_config
  from public.game_sessions
  where site_id = profile.site_id and game_type = requested_game_type
  order by created_at desc limit 1;
  return private.start_game_impl(requested_game_type, coalesce(prior_config, '{}'::jsonb));
end;
$$;

create or replace function private.reset_game_scores_impl(requested_game_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.couple_profiles%rowtype;
begin
  select * into profile from public.couple_profiles where user_id = (select auth.uid()) limit 1;
  if not found then raise exception 'Account is not linked to this corner' using errcode = '42501'; end if;
  if requested_game_type not in ('number', 'word') then raise exception 'Unsupported game type' using errcode = '22023'; end if;
  insert into public.game_scores (site_id, game_type, frog_wins, princess_wins, updated_at)
  values (profile.site_id, requested_game_type, 0, 0, now())
  on conflict (site_id, game_type) do update
  set frog_wins = 0, princess_wins = 0, updated_at = now();
  return private.game_state_impl(requested_game_type);
end;
$$;

revoke all on function private.game_state_impl(text) from public, anon, authenticated;
revoke all on function private.start_game_impl(text, jsonb) from public, anon, authenticated;
revoke all on function private.lock_game_secret_impl(uuid, text) from public, anon, authenticated;
revoke all on function private.submit_game_guess_impl(uuid, text) from public, anon, authenticated;
revoke all on function private.request_game_rematch_impl(text) from public, anon, authenticated;
revoke all on function private.reset_game_scores_impl(text) from public, anon, authenticated;

create or replace function public.game_get_state(p_game_type text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select private.game_state_impl(p_game_type); $$;

create or replace function public.start_game(p_game_type text, p_config jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.start_game_impl(p_game_type, p_config); $$;

create or replace function public.lock_game_secret(p_session_id uuid, p_secret text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.lock_game_secret_impl(p_session_id, p_secret); $$;

create or replace function public.submit_game_guess(p_session_id uuid, p_guess text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.submit_game_guess_impl(p_session_id, p_guess); $$;

create or replace function public.request_game_rematch(p_game_type text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.request_game_rematch_impl(p_game_type); $$;

create or replace function public.reset_game_scores(p_game_type text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.reset_game_scores_impl(p_game_type); $$;

revoke all on function public.game_get_state(text) from public, anon;
revoke all on function public.start_game(text, jsonb) from public, anon;
revoke all on function public.lock_game_secret(uuid, text) from public, anon;
revoke all on function public.submit_game_guess(uuid, text) from public, anon;
revoke all on function public.request_game_rematch(text) from public, anon;
revoke all on function public.reset_game_scores(text) from public, anon;
grant execute on function public.game_get_state(text) to authenticated;
grant execute on function public.start_game(text, jsonb) to authenticated;
grant execute on function public.lock_game_secret(uuid, text) to authenticated;
grant execute on function public.submit_game_guess(uuid, text) to authenticated;
grant execute on function public.request_game_rematch(text) to authenticated;
grant execute on function public.reset_game_scores(text) to authenticated;

drop policy if exists "corner_members_realtime_read" on realtime.messages;
create policy "corner_members_realtime_read"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.couple_profiles profile
    where profile.user_id = (select auth.uid())
      and (select realtime.topic()) = 'corner:' || profile.site_id
  )
);

drop policy if exists "corner_members_realtime_send" on realtime.messages;
create policy "corner_members_realtime_send"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.couple_profiles profile
    where profile.user_id = (select auth.uid())
      and (select realtime.topic()) = 'corner:' || profile.site_id
  )
);

do $$
begin
  alter publication supabase_realtime add table public.game_sessions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.game_players;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.game_moves;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.game_scores;
exception when duplicate_object then null;
end $$;

comment on table private.game_secrets is 'Server-only multiplayer secrets. Browser roles have no table access.';
comment on function public.submit_game_guess(uuid, text) is 'Atomically validates a turn, evaluates a private secret, records the move, and advances the game.';
