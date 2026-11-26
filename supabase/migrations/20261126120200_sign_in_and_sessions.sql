-- FamilyFi: sign-in and sessions (Slice 5, migration 3)
--
-- This file adds:
--   * start_session             starts a session for a person
--   * sign_in_with_code         signs a person in with their access code
--   * get_session               says who a browser belongs to, if anyone
--   * end_session               signs a browser out
--   * get_access_code_material  the locked copy of a person's access code,
--                               so the server can show it to them again
--
-- It needs migrations 1 and 2 of Slice 5 to have been run first.
--
-- It runs in an ordinary Postgres: no extensions are used. Who may call
-- these functions is set in 20261126120300_grants.sql (Supabase only).
--
-- A browser's session token and a person's access code never reach the
-- database as they are. The server sends only their fingerprints
-- (SHA-256, 64 lowercase hexadecimal characters).
--
-- Every function gives its answer as JSON, or nothing (null) when there
-- is nothing to give.


-- ---------------------------------------------------------------------
-- START A SESSION
-- ---------------------------------------------------------------------

-- start_session: creates one session row for a person. Used by sign-up,
-- straight after create_household, and by sign_in_with_code below.
--   p_idle_days      the session ends after this many days without use
--   p_absolute_days  the session ends after this many days whatever
-- Gives back {"session_id": "<id>"}.
-- Refuses with "bad_request: ..." if a value is not in the expected form.
create function public.start_session(
  p_customer_id uuid,
  p_token_hash text,
  p_idle_days integer,
  p_absolute_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if p_customer_id is null
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_idle_days is null or p_idle_days < 1
     or p_absolute_days is null or p_absolute_days < p_idle_days then
    raise exception 'bad_request: A session value is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'bad_request: That person does not exist.'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.sessions (customer_id, token_hash, idle_expires_at, absolute_expires_at)
  values (
    p_customer_id,
    p_token_hash,
    now() + make_interval(days => p_idle_days),
    now() + make_interval(days => p_absolute_days)
  )
  returning id into v_session_id;

  return jsonb_build_object('session_id', v_session_id);
end;
$$;


-- ---------------------------------------------------------------------
-- SIGN IN WITH AN ACCESS CODE
-- ---------------------------------------------------------------------

-- sign_in_with_code: checks an access code and, if it is right, starts a
-- session for its owner.
--
-- What it is given: the fingerprint of the code that was typed, the
-- fingerprint of a new session token, the visitor's fingerprint, the two
-- wrong-code limits (per 15 minutes and per 24 hours), and the session
-- lengths in days.
--
-- What it gives back, always as a result and never as a raised error:
--   {"status": "signed_in", "customer_id": "...", "household_id": "..."}
--   {"status": "wrong_code"}         the code matches nobody; counted
--   {"status": "too_many_attempts"}  this visitor is over a wrong-code
--                                    limit; refused even if the code is
--                                    right, and not counted again
--   {"status": "no_household"}       the code is right but its owner has
--                                    no household (should never happen)
--
-- Why a result and not an error: a raised error throws away everything
-- this save did, including the row that counts the wrong code. The limit
-- would then never count. Returning normally keeps that row.
--
-- Only a value the server made that is not in the expected form, or a
-- limit that is not a whole number of 1 or more, is refused as an error
-- ("bad_request: ..."). Those are mistakes in the app, not by a visitor.
create function public.sign_in_with_code(
  p_code_hash text,
  p_token_hash text,
  p_visitor_hash text,
  p_max_wrong_per_15_minutes integer,
  p_max_wrong_per_24_hours integer,
  p_idle_days integer,
  p_absolute_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wrong_15_minutes bigint;
  v_wrong_24_hours bigint;
  v_customer_id uuid;
  v_household_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request: A value made by the server is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_max_wrong_per_15_minutes is null or p_max_wrong_per_15_minutes < 1
     or p_max_wrong_per_24_hours is null or p_max_wrong_per_24_hours < 1 then
    raise exception 'bad_request: Every limit must be a whole number of 1 or more.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- One sign-in at a time for each visitor, so two attempts at the same
  -- instant cannot both slip under the limit. Other visitors are not held
  -- up. (42071 is simply the number FamilyFi uses to name these locks.)
  perform pg_advisory_xact_lock(42071, hashtext(p_visitor_hash));

  -- Clear counter rows older than 7 days.
  perform public.clean_up_auth_attempts();

  -- Is this visitor over a wrong-code limit? Checked before the code is
  -- even looked at, so an over-the-limit visitor learns nothing about
  -- whether the code was right.
  select
    count(*) filter (where a.created_at > now() - interval '15 minutes'),
    count(*) filter (where a.created_at > now() - interval '24 hours')
    into v_wrong_15_minutes, v_wrong_24_hours
  from public.auth_attempts a
  where a.kind = 'sign_in_failed'
    and a.visitor_hash = p_visitor_hash
    and a.created_at > now() - interval '24 hours';

  if v_wrong_15_minutes >= p_max_wrong_per_15_minutes
     or v_wrong_24_hours >= p_max_wrong_per_24_hours then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;

  -- Whose code is it?
  select ac.customer_id into v_customer_id
  from public.access_codes ac
  where ac.code_hash = p_code_hash;

  if v_customer_id is null then
    -- A wrong code. Count it, and keep the count: this function returns
    -- normally, so the row below is saved.
    insert into public.auth_attempts (kind, visitor_hash)
    values ('sign_in_failed', p_visitor_hash);
    return jsonb_build_object('status', 'wrong_code');
  end if;

  select m.household_id into v_household_id
  from public.household_members m
  where m.customer_id = v_customer_id;

  if v_household_id is null then
    return jsonb_build_object('status', 'no_household');
  end if;

  perform public.start_session(v_customer_id, p_token_hash, p_idle_days, p_absolute_days);

  return jsonb_build_object(
    'status', 'signed_in',
    'customer_id', v_customer_id,
    'household_id', v_household_id
  );
end;
$$;


-- ---------------------------------------------------------------------
-- WHO IS THIS BROWSER?
-- ---------------------------------------------------------------------

-- get_session: given the fingerprint of the token in a browser's cookie,
-- gives back who is signed in there:
--   {"customer_id", "household_id", "household_name", "full_name", "role"}
-- or nothing (null) if there is no active session: no such token, signed
-- out, unused for too long, or past its absolute limit. A token that is
-- not in the expected form also gives nothing, rather than an error.
--
-- Keeping a session alive: when it is used, and it has not been moved on
-- in the last hour, its last use is set to now and its idle limit is
-- pushed forward by the same length it had. It is never pushed past the
-- absolute limit. Doing this at most once an hour means most page views
-- do not write anything.
--
-- How the idle length is known without storing it: every time the idle
-- limit is set, it is set to "last use + idle length" (or the absolute
-- limit, if that comes first). So "idle limit minus last use" is always
-- the idle length, or less once the absolute limit is near, in which case
-- the limit stays at the absolute limit anyway.
--
-- Because it can write, it must be called as an ordinary call (POST), not
-- as a read-only one.
create function public.get_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_last_used_at timestamptz;
  v_idle_expires_at timestamptz;
  v_absolute_expires_at timestamptz;
  v_customer_id uuid;
  v_household_id uuid;
  v_household_name text;
  v_full_name text;
  v_role text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select s.id, s.last_used_at, s.idle_expires_at, s.absolute_expires_at,
         s.customer_id, m.household_id, h.name, c.full_name, c.role
    into v_session_id, v_last_used_at, v_idle_expires_at, v_absolute_expires_at,
         v_customer_id, v_household_id, v_household_name, v_full_name, v_role
  from public.sessions s
  join public.customers c on c.id = s.customer_id
  join public.household_members m on m.customer_id = s.customer_id
  join public.households h on h.id = m.household_id
  where s.token_hash = p_token_hash
    and s.ended_at is null
    and now() < s.idle_expires_at
    and now() < s.absolute_expires_at;

  if v_session_id is null then
    return null;
  end if;

  if v_last_used_at < now() - interval '1 hour' then
    update public.sessions s
    set last_used_at = now(),
        idle_expires_at = least(now() + (v_idle_expires_at - v_last_used_at), v_absolute_expires_at)
    where s.id = v_session_id;
  end if;

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'household_id', v_household_id,
    'household_name', v_household_name,
    'full_name', v_full_name,
    'role', v_role
  );
end;
$$;


-- ---------------------------------------------------------------------
-- SIGN OUT
-- ---------------------------------------------------------------------

-- end_session: signs a browser out by marking its session as ended. A
-- session can only be ended once; ending it again changes nothing.
-- Gives back {"ended": true} if a session was ended just now, or
-- {"ended": false} if there was no such session or it had already ended.
create function public.end_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ended', false);
  end if;

  update public.sessions s
  set ended_at = now()
  where s.token_hash = p_token_hash
    and s.ended_at is null;

  return jsonb_build_object('ended', found);
end;
$$;


-- ---------------------------------------------------------------------
-- THE LOCKED ACCESS CODE
-- ---------------------------------------------------------------------

-- get_access_code_material: gives back the locked copy of a person's
-- access code and the version of the key that locked it:
--   {"code_encrypted": "...", "key_version": 1}
-- or nothing (null) if the person has no access code. Only the server can
-- unlock it, with its own key, to show the code on /welcome and the
-- profile screen. The person is always the one from the signed-in
-- session, chosen by the server.
create function public.get_access_code_material(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code_encrypted text;
  v_key_version integer;
begin
  select ac.code_encrypted, ac.key_version
    into v_code_encrypted, v_key_version
  from public.access_codes ac
  where ac.customer_id = p_customer_id;

  if v_code_encrypted is null then
    return null;
  end if;

  return jsonb_build_object(
    'code_encrypted', v_code_encrypted,
    'key_version', v_key_version
  );
end;
$$;
