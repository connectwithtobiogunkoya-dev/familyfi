-- FamilyFi: inviting a partner and joining a household (Slice 6, migration 2)
--
-- This file adds:
--   * create_invite           the owner creates a one-time invite code
--   * get_active_invite       the owner sees their unused code again
--   * join_household          a partner joins with the code, and is signed
--                             up and signed in, all in one save
--   * get_household_members   the names and roles of a household's members
--
-- It needs every Slice 5 migration and 20261127120000_household_invites.sql
-- to have been run first.
--
-- It runs in an ordinary Postgres: no extensions are used. Who may call
-- these functions is set in 20261127130100_invite_functions_grants.sql
-- (Supabase only).
--
-- None of these functions takes a household id. The household is always
-- found here, from the person's own membership, using the customer id the
-- server took from that person's session.
--
-- Invite codes and access codes never reach the database as they are. The
-- server sends only their fingerprints (SHA-256, 64 lowercase hexadecimal
-- characters), plus a copy locked with a key only the server holds.
--
-- THE LOCKS (advisory locks, each let go when its save ends):
--   42071, <visitor>     one attempt at a time for each visitor, shared
--                        with sign_in_with_code, so two attempts at the
--                        same instant cannot both slip under a limit
--   4207100              the sign-up lock, shared with create_household,
--                        so the per-visitor, daily and total counts are
--                        never read by two sign-ups at once
--   42072, <household>   one change at a time to a household's invites
--                        and members (new in this file)
-- They are always taken in this order (visitor, then household, then
-- sign-up), and no function takes them in another order, so two saves
-- can never wait for each other for ever.


-- ---------------------------------------------------------------------
-- CREATING AN INVITE
-- ---------------------------------------------------------------------

-- create_invite: the owner of a household creates a new invite code.
--
-- What it is given:
--   p_customer_id     the person asking, from their session
--   p_code_hash       the new invite code's fingerprint
--   p_code_encrypted  its locked copy, so the owner can see it again
--   p_key_version     the version of the key that locked it
--   p_max_per_day     how many invites one household may make in any
--                     24 hours (voided ones count)
--
-- In one save: the household's older unused invite, if any, is voided and
-- its locked copy cleared, whether or not it is past its time; then the new
-- one is added, lasting 48 hours.
--
-- What it gives back: {"invite_id": "<id>", "expires_at": "<time>"}
--
-- Refusal codes (at the start of the message, before the colon):
--   bad_request     a value the server made, or the limit, is not valid
--   not_owner       the person is not the owner of a household
--   household_full  the household already has a partner
--   limit_invites   the household has made too many invites in 24 hours
--   code_taken      the invite code's fingerprint is already in use
create function public.create_invite(
  p_customer_id uuid,
  p_code_hash text,
  p_code_encrypted text,
  p_key_version integer,
  p_max_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_member_role text;
  v_count bigint;
  v_invite_id uuid;
  v_expires_at timestamptz;
begin
  if p_customer_id is null
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_code_encrypted is null or char_length(p_code_encrypted) = 0
     or p_key_version is null or p_key_version < 1 then
    raise exception 'bad_request: A value made by the server is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_max_per_day is null or p_max_per_day < 0 then
    raise exception 'bad_request: Every limit must be a whole number of 0 or more.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The person's own household, and their place in it.
  select m.household_id, m.member_role
    into v_household_id, v_member_role
  from public.household_members m
  where m.customer_id = p_customer_id;

  -- Only the owner may invite. (The table's own rule refuses it too.)
  if v_household_id is null or v_member_role <> 'owner' then
    raise exception 'not_owner: Only the household''s owner can create an invite.'
      using errcode = 'insufficient_privilege';
  end if;

  -- One change at a time to this household's invites, so two quick taps
  -- cannot both void and add.
  perform pg_advisory_xact_lock(42072, hashtext(v_household_id::text));

  if exists (
    select 1
    from public.household_members m
    where m.household_id = v_household_id
      and m.member_role = 'partner'
  ) then
    raise exception 'household_full: The household already has a partner.'
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_count
  from public.household_invites i
  where i.household_id = v_household_id
    and i.created_at > now() - interval '24 hours';
  if v_count >= p_max_per_day then
    raise exception 'limit_invites: This household has made too many invites in the last 24 hours.'
      using errcode = 'program_limit_exceeded';
  end if;

  if exists (select 1 from public.household_invites i where i.code_hash = p_code_hash) then
    raise exception 'code_taken: That invite code is already in use.'
      using errcode = 'unique_violation';
  end if;

  -- Void the older unused invite, past its time or not, and clear its
  -- locked copy. This must happen before the insert below: the one-active
  -- index cannot tell an expired invite from a live one.
  update public.household_invites i
  set voided_at = now(),
      code_encrypted = null,
      key_version = null
  where i.household_id = v_household_id
    and i.used_at is null
    and i.voided_at is null;

  insert into public.household_invites (household_id, created_by, code_hash, code_encrypted, key_version)
  values (v_household_id, p_customer_id, p_code_hash, p_code_encrypted, p_key_version)
  returning id, expires_at into v_invite_id, v_expires_at;

  return jsonb_build_object(
    'invite_id', v_invite_id,
    'expires_at', v_expires_at
  );
end;
$$;


-- ---------------------------------------------------------------------
-- SEEING THE UNUSED INVITE AGAIN
-- ---------------------------------------------------------------------

-- get_active_invite: for the owner of a household, gives back the
-- household's unused invite that is still within its time:
--   {"code_encrypted": "...", "key_version": 1, "expires_at": "<time>"}
-- or nothing (null) when there is none. A partner always gets nothing, and
-- so does anyone with no household.
--
-- If the household's unused invite is past its time, this voids it and
-- clears its locked copy, in the same call, and gives back nothing. That
-- is why it can write, and must be called as an ordinary call (POST), not
-- as a read-only one.
create function public.get_active_invite(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_member_role text;
  v_invite_id uuid;
  v_code_encrypted text;
  v_key_version integer;
  v_expires_at timestamptz;
begin
  if p_customer_id is null then
    return null;
  end if;

  select m.household_id, m.member_role
    into v_household_id, v_member_role
  from public.household_members m
  where m.customer_id = p_customer_id;

  if v_household_id is null or v_member_role <> 'owner' then
    return null;
  end if;

  -- The same household lock as create_invite and join_household, because
  -- this may void an invite.
  perform pg_advisory_xact_lock(42072, hashtext(v_household_id::text));

  select i.id, i.code_encrypted, i.key_version, i.expires_at
    into v_invite_id, v_code_encrypted, v_key_version, v_expires_at
  from public.household_invites i
  where i.household_id = v_household_id
    and i.used_at is null
    and i.voided_at is null;

  if v_invite_id is null then
    return null;
  end if;

  if v_expires_at <= now() then
    update public.household_invites i
    set voided_at = now(),
        code_encrypted = null,
        key_version = null
    where i.id = v_invite_id;
    return null;
  end if;

  return jsonb_build_object(
    'code_encrypted', v_code_encrypted,
    'key_version', v_key_version,
    'expires_at', v_expires_at
  );
end;
$$;


-- ---------------------------------------------------------------------
-- JOINING A HOUSEHOLD
-- ---------------------------------------------------------------------

-- join_household: a partner joins a household with its invite code, and
-- is signed up and signed in, all in one save. Either every row below is
-- created, or none is.
--
-- What it is given, in this order (the same order as create_household
-- wherever the two share a value):
--   the typed details, already checked and tidied on the server:
--     p_full_name, p_phone, p_date_of_birth, p_role, p_nin, p_bvn,
--     p_test_terms_accepted
--     (no household name: the partner joins a household that has one)
--   p_invite_hash       the fingerprint of the invite code that was typed
--   values the server made:
--     p_code_hash       the partner's new access code's fingerprint
--     p_code_encrypted  its locked copy
--     p_key_version     the version of the key that locked it
--     p_visitor_hash    the visitor's fingerprint
--   the limits, as whole numbers:
--     p_max_signups_per_visitor            sign-ups per visitor in 24 hours
--     p_max_customers_per_day              customers per day, for everyone
--     p_max_customers_total                customers in total
--     p_max_wrong_invites_per_15_minutes   wrong invite codes per visitor
--     p_max_wrong_invites_per_24_hours     wrong invite codes per visitor
--   the first session:
--     p_token_hash, p_idle_days, p_absolute_days
--
-- The steps, in this order:
--   0. The values the server made and the limits are checked. A mistake
--      here is in the app, not by the visitor: bad_request, raised.
--   1. Is this visitor over a wrong-invite limit? If so:
--      {"status": "too_many_attempts"}, and nothing new is recorded.
--   2. The invite is found by its fingerprint and its row locked. If it is
--      not there, used, voided or past its time: one invite_failed row is
--      recorded and {"status": "invite_not_valid"} is given back. The
--      answer is the same for all four, so it says nothing about which.
--   3. The sign-up limits, exactly as create_household counts them. A join
--      is a sign-up. Over a limit: limit_visitor, limit_daily or
--      limit_total, raised.
--   4. If the household already has a partner (a second wall: a used
--      invite already covers this): one invite_failed row, and
--      {"status": "invite_not_valid"}.
--   5. The typed details, checked again exactly as create_household does,
--      and the access code fingerprint: bad_details, not_verified,
--      under_18 or code_taken, raised. Either role is allowed.
--   6. The customer, their membership as partner, their access code, one
--      sign_up row, their first session, and the invite marked used with
--      its locked copy cleared. No accounts and no account numbers: the
--      partner shares the household's.
--   7. {"status": "joined", "customer_id", "household_id", "session_id"}.
--
-- Why steps 1, 2 and 4 give back a status instead of raising an error: a
-- raised error throws away everything this save did, including the row
-- that counts a wrong invite code, so the limit would never count.
-- Returning normally keeps that row. A raised error in steps 0, 3 and 5
-- saves nothing at all, not even an attempt row.
--
-- Two people using one invite at the same moment: exactly one can join.
--   * Both take the household lock (42072) before they lock the invite's
--     row, so the second waits until the first has finished.
--   * The second then reads the invite again, sees it used, records an
--     invite_failed row and gives back invite_not_valid.
--   * Even if that were somehow bypassed, the one-partner index on
--     household_members refuses a second partner, and the invite's own
--     rules refuse marking it used twice. Either refusal throws the
--     second save away whole.
create function public.join_household(
  p_full_name text,
  p_phone text,
  p_date_of_birth date,
  p_role text,
  p_nin text,
  p_bvn text,
  p_test_terms_accepted boolean,
  p_invite_hash text,
  p_code_hash text,
  p_code_encrypted text,
  p_key_version integer,
  p_visitor_hash text,
  p_max_signups_per_visitor integer,
  p_max_customers_per_day integer,
  p_max_customers_total integer,
  p_max_wrong_invites_per_15_minutes integer,
  p_max_wrong_invites_per_24_hours integer,
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
  v_full_name text;
  v_lagos_today date;
  v_lagos_midnight timestamptz;
  v_count bigint;
  v_wrong_15_minutes bigint;
  v_wrong_24_hours bigint;
  v_invite_id uuid;
  v_household_id uuid;
  v_used_at timestamptz;
  v_voided_at timestamptz;
  v_expires_at timestamptz;
  v_customer_id uuid;
  v_session_id uuid;
begin
  -- -------------------------------------------------------------------
  -- 0. The values the server made, and the limits.
  -- -------------------------------------------------------------------
  if p_invite_hash is null or p_invite_hash !~ '^[0-9a-f]{64}$'
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_code_encrypted is null or char_length(p_code_encrypted) = 0
     or p_key_version is null or p_key_version < 1
     or p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request: A value made by the server is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_max_signups_per_visitor is null or p_max_signups_per_visitor < 0
     or p_max_customers_per_day is null or p_max_customers_per_day < 0
     or p_max_customers_total is null or p_max_customers_total < 0
     or p_max_wrong_invites_per_15_minutes is null or p_max_wrong_invites_per_15_minutes < 1
     or p_max_wrong_invites_per_24_hours is null or p_max_wrong_invites_per_24_hours < 1 then
    raise exception 'bad_request: A limit is not a whole number in the allowed range.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_idle_days is null or p_idle_days < 1
     or p_absolute_days is null or p_absolute_days < p_idle_days then
    raise exception 'bad_request: A session value is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- -------------------------------------------------------------------
  -- 1. The wrong-invite limit for this visitor, checked before the code
  --    is even looked at, so a visitor over the limit learns nothing.
  --    The same per-visitor lock as sign_in_with_code.
  -- -------------------------------------------------------------------
  perform pg_advisory_xact_lock(42071, hashtext(p_visitor_hash));

  perform public.clean_up_auth_attempts();

  select
    count(*) filter (where a.created_at > now() - interval '15 minutes'),
    count(*) filter (where a.created_at > now() - interval '24 hours')
    into v_wrong_15_minutes, v_wrong_24_hours
  from public.auth_attempts a
  where a.kind = 'invite_failed'
    and a.visitor_hash = p_visitor_hash
    and a.created_at > now() - interval '24 hours';

  if v_wrong_15_minutes >= p_max_wrong_invites_per_15_minutes
     or v_wrong_24_hours >= p_max_wrong_invites_per_24_hours then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;

  -- -------------------------------------------------------------------
  -- 2. The invite. First only which household it belongs to; then the
  --    household lock; then the invite's row, locked, read again. Taking
  --    the household lock first keeps the lock order the same as
  --    create_invite's, so the two can never wait for each other.
  -- -------------------------------------------------------------------
  select i.household_id into v_household_id
  from public.household_invites i
  where i.code_hash = p_invite_hash;

  if v_household_id is null then
    insert into public.auth_attempts (kind, visitor_hash)
    values ('invite_failed', p_visitor_hash);
    return jsonb_build_object('status', 'invite_not_valid');
  end if;

  perform pg_advisory_xact_lock(42072, hashtext(v_household_id::text));

  select i.id, i.used_at, i.voided_at, i.expires_at
    into v_invite_id, v_used_at, v_voided_at, v_expires_at
  from public.household_invites i
  where i.code_hash = p_invite_hash
  for update;

  if v_invite_id is null
     or v_used_at is not null
     or v_voided_at is not null
     or v_expires_at <= now() then
    insert into public.auth_attempts (kind, visitor_hash)
    values ('invite_failed', p_visitor_hash);
    return jsonb_build_object('status', 'invite_not_valid');
  end if;

  -- -------------------------------------------------------------------
  -- 3. The sign-up limits, counted exactly as create_household counts
  --    them, under the same sign-up lock.
  -- -------------------------------------------------------------------
  perform pg_advisory_xact_lock(4207100);

  select count(*) into v_count
  from public.auth_attempts a
  where a.kind = 'sign_up'
    and a.visitor_hash = p_visitor_hash
    and a.created_at > now() - interval '24 hours';
  if v_count >= p_max_signups_per_visitor then
    raise exception 'limit_visitor: This visitor has reached the sign-up limit for now.'
      using errcode = 'program_limit_exceeded';
  end if;

  v_lagos_today := (now() at time zone 'Africa/Lagos')::date;
  v_lagos_midnight := v_lagos_today::timestamp at time zone 'Africa/Lagos';
  select count(*) into v_count
  from public.customers c
  where c.created_at >= v_lagos_midnight;
  if v_count >= p_max_customers_per_day then
    raise exception 'limit_daily: Today''s sign-up limit has been reached.'
      using errcode = 'program_limit_exceeded';
  end if;

  select count(*) into v_count
  from public.customers c;
  if v_count >= p_max_customers_total then
    raise exception 'limit_total: The total sign-up limit has been reached.'
      using errcode = 'program_limit_exceeded';
  end if;

  -- -------------------------------------------------------------------
  -- 4. The household must not have a partner already.
  -- -------------------------------------------------------------------
  if exists (
    select 1
    from public.household_members m
    where m.household_id = v_household_id
      and m.member_role = 'partner'
  ) then
    insert into public.auth_attempts (kind, visitor_hash)
    values ('invite_failed', p_visitor_hash);
    return jsonb_build_object('status', 'invite_not_valid');
  end if;

  -- -------------------------------------------------------------------
  -- 5. The typed details, checked again exactly as create_household
  --    checks them, and the access code. Either role is allowed.
  -- -------------------------------------------------------------------
  v_full_name := btrim(coalesce(p_full_name, ''));
  if char_length(v_full_name) < 2 or char_length(v_full_name) > 100 then
    raise exception 'bad_details: The full name must be 2 to 100 characters.'
      using errcode = 'check_violation';
  end if;

  if p_phone is null or p_phone !~ '^000[0-9]{8}$' then
    raise exception 'bad_details: The phone must be a test number: 11 digits starting with 000.'
      using errcode = 'check_violation';
  end if;

  if p_nin is null or p_nin !~ '^000[0-9]{8}$' then
    raise exception 'bad_details: The NIN must be a test number: 11 digits starting with 000.'
      using errcode = 'check_violation';
  end if;

  if p_bvn is null or p_bvn !~ '^000[0-9]{8}$' then
    raise exception 'bad_details: The BVN must be a test number: 11 digits starting with 000.'
      using errcode = 'check_violation';
  end if;

  if p_role is null or p_role not in ('husband', 'wife') then
    raise exception 'bad_details: The role must be husband or wife.'
      using errcode = 'check_violation';
  end if;

  if p_test_terms_accepted is distinct from true then
    raise exception 'bad_details: The test-terms box must be ticked.'
      using errcode = 'check_violation';
  end if;

  if p_date_of_birth is null or p_date_of_birth < date '1900-01-01' or p_date_of_birth > v_lagos_today then
    raise exception 'bad_details: The date of birth must be a real past date.'
      using errcode = 'check_violation';
  end if;

  -- The simulated identity check: a NIN or BVN ending in 99 fails.
  if p_nin ~ '99$' or p_bvn ~ '99$' then
    raise exception 'not_verified: The simulated identity check did not pass.'
      using errcode = 'check_violation';
  end if;

  -- 18 or over: born on or before this date 18 years ago, in Lagos.
  if p_date_of_birth > (v_lagos_today - interval '18 years')::date then
    raise exception 'under_18: The person must be 18 or over.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.access_codes ac where ac.code_hash = p_code_hash) then
    raise exception 'code_taken: That access code is already in use.'
      using errcode = 'unique_violation';
  end if;

  -- -------------------------------------------------------------------
  -- 6. Create everything, in this one save.
  -- -------------------------------------------------------------------
  insert into public.customers (
    full_name, phone, date_of_birth, role, nin, bvn,
    verification_status, verification_method, verified_at, test_terms_accepted_at
  )
  values (
    v_full_name, p_phone, p_date_of_birth, p_role, p_nin, p_bvn,
    'verified', 'simulated', now(), now()
  )
  returning id into v_customer_id;

  -- The one-partner index refuses this if a partner somehow got in first.
  insert into public.household_members (household_id, customer_id, member_role)
  values (v_household_id, v_customer_id, 'partner');

  insert into public.access_codes (customer_id, code_hash, code_encrypted, key_version)
  values (v_customer_id, p_code_hash, p_code_encrypted, p_key_version);

  insert into public.auth_attempts (kind, visitor_hash)
  values ('sign_up', p_visitor_hash);

  insert into public.sessions (customer_id, token_hash, idle_expires_at, absolute_expires_at)
  values (
    v_customer_id,
    p_token_hash,
    now() + make_interval(days => p_idle_days),
    now() + make_interval(days => p_absolute_days)
  )
  returning id into v_session_id;

  -- The invite is used, by this partner, and its locked copy is cleared.
  -- The invite's own rules check that this person is now a partner of
  -- the same household.
  update public.household_invites i
  set used_at = now(),
      used_by = v_customer_id,
      code_encrypted = null,
      key_version = null
  where i.id = v_invite_id;

  -- -------------------------------------------------------------------
  -- 7. Done.
  -- -------------------------------------------------------------------
  return jsonb_build_object(
    'status', 'joined',
    'customer_id', v_customer_id,
    'household_id', v_household_id,
    'session_id', v_session_id
  );
end;
$$;


-- ---------------------------------------------------------------------
-- WHO IS IN THE HOUSEHOLD
-- ---------------------------------------------------------------------

-- get_household_members: the members of the person's own household:
--   [{"full_name": "...", "member_role": "owner", "is_you": true}, ...]
-- the owner first, then the partner. Names and roles only: never a phone,
-- NIN, BVN, date of birth, access code or any id. Nothing (null) if the
-- person has no household. It only reads, and changes nothing.
create function public.get_household_members(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  if p_customer_id is null then
    return null;
  end if;

  select m.household_id into v_household_id
  from public.household_members m
  where m.customer_id = p_customer_id;

  if v_household_id is null then
    return null;
  end if;

  return (
    select jsonb_agg(
             jsonb_build_object(
               'full_name', c.full_name,
               'member_role', m.member_role,
               'is_you', m.customer_id = p_customer_id
             )
             order by (m.member_role <> 'owner'), m.joined_at
           )
    from public.household_members m
    join public.customers c on c.id = m.customer_id
    where m.household_id = v_household_id
  );
end;
$$;
