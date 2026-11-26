-- FamilyFi: creating a household (Slice 5, migration 2)
--
-- This file adds:
--   * nuban_check_digit       the CBN NUBAN check digit (2020 standard)
--   * new_account_number      a new, unique 10-digit test account number
--   * clean_up_auth_attempts  removes counter rows older than 7 days
--   * create_household        signs a person up: their household, their
--                             accounts and their access code, in one save
--
-- It needs migration 1 (20261126120000_customers_and_sessions.sql) and the
-- ledger migrations to have been run first.
--
-- It runs in an ordinary Postgres: no extensions are used. Who may call
-- these functions is set in 20261126120300_grants.sql (Supabase only).
--
-- HOW REFUSALS ARE TOLD APART
-- Every refusal raised by create_household starts with a short, stable
-- code, then a colon, then a plain sentence, for example:
--   "under_18: The person must be 18 or over."
-- The app reads only the code before the colon and shows its own fixed
-- sentence. The codes are listed above create_household below.


-- ---------------------------------------------------------------------
-- NUBAN CHECK DIGIT
-- ---------------------------------------------------------------------

-- The check digit of a NUBAN account number, following the Central Bank
-- of Nigeria's Revised Standards on NUBAN (2020):
--   1. Pad the institution code to 6 digits with zeros in front.
--   2. Put it in front of the 9-digit serial number: 15 digits.
--   3. Multiply the digits by 3,7,3,3,7,3,3,7,3,3,7,3,3,7,3 and add them.
--   4. The check digit is 10 minus (that sum divided by 10, remainder),
--      or 0 when the answer is 10.
-- The CBN's own example: code 011 (or 000011) with serial 000001457
-- gives 9, so the account number is 0000014579.
-- This reads no tables, so it is the same every time for the same input.
create function public.nuban_check_digit(p_institution_code text, p_serial text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_weights integer[] := array[3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
  v_digits text;
  v_sum integer := 0;
  v_position integer;
begin
  if p_institution_code is null or p_institution_code !~ '^[0-9]{1,6}$' then
    raise exception 'bad_request: The institution code must be 1 to 6 digits.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_serial is null or p_serial !~ '^[0-9]{9}$' then
    raise exception 'bad_request: The serial number must be exactly 9 digits.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_digits := lpad(p_institution_code, 6, '0') || p_serial;

  for v_position in 1..15 loop
    v_sum := v_sum + substr(v_digits, v_position, 1)::integer * v_weights[v_position];
  end loop;

  return (10 - (v_sum % 10)) % 10;
end;
$$;


-- ---------------------------------------------------------------------
-- A NEW ACCOUNT NUMBER
-- ---------------------------------------------------------------------

-- Makes a new 10-digit test account number for FamilyFi's bank code 000:
-- a random 9-digit serial number followed by its check digit.
--
-- Where the randomness comes from: gen_random_uuid(), which is built into
-- Postgres and uses a strong random source. Its first 12 hexadecimal
-- characters (48 random bits) are turned into a whole number, and the
-- last 9 decimal digits of that number become the serial.
--
-- A number that is already taken is drawn again, up to 20 times. With a
-- thousand million possible serials and at most a few hundred households,
-- needing even a second try is very unlikely; 20 failures in a row would
-- mean something is badly wrong, so it stops with a clear refusal.
--
-- It does not lock anything itself. create_household calls it while
-- holding its own lock, so two sign-ups cannot pick the same number at
-- the same moment.
create function public.new_account_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_try integer;
  v_random bigint;
  v_serial text;
  v_number text;
begin
  for v_try in 1..20 loop
    v_random := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint;
    v_serial := lpad((v_random % 1000000000)::text, 9, '0');
    v_number := v_serial || public.nuban_check_digit('000', v_serial)::text;

    if not exists (
      select 1 from public.account_numbers n where n.account_number = v_number
    ) then
      return v_number;
    end if;
  end loop;

  raise exception 'numbers_exhausted: No unused account number was found after 20 tries.'
    using errcode = 'program_limit_exceeded';
end;
$$;


-- ---------------------------------------------------------------------
-- CLEARING OLD COUNTER ROWS
-- ---------------------------------------------------------------------

-- Removes auth_attempts rows older than 7 days. The limits only ever look
-- back 24 hours, so these rows are never needed again. It is called by
-- create_household and by the sign-in function each time they run, so
-- the table never grows far. Returns how many rows were removed.
create function public.clean_up_auth_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from public.auth_attempts a
  where a.created_at < now() - interval '7 days';

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;


-- ---------------------------------------------------------------------
-- CREATING A HOUSEHOLD
-- ---------------------------------------------------------------------

-- create_household: signs a person up and signs them in, all in one save.
-- Either every row below is created, or none is. So a household can never
-- exist without its owner having been signed in to see their access code.
--
-- What it is given, in this order:
--   the typed details, already checked and tidied on the server:
--     p_full_name, p_phone, p_date_of_birth, p_role, p_nin, p_bvn,
--     p_household_name (may be empty), and p_test_terms_accepted (whether
--     the test-terms box was ticked)
--   values the server made:
--     p_code_hash       the access code's fingerprint
--     p_code_encrypted  its locked copy
--     p_key_version     the version of the key that locked it
--     p_visitor_hash    the visitor's fingerprint
--   the limits, as whole numbers, so they can change without a new file:
--     p_max_signups_per_visitor  sign-ups per visitor in 24 hours
--     p_max_customers_per_day    customers per day, for everyone
--     p_max_customers_total      customers in total
--   the first session:
--     p_token_hash      the fingerprint of the new session token
--     p_idle_days       the session ends after this many days without use
--     p_absolute_days   the session ends after this many days whatever
--
-- What it creates:
--   one household, one customer, one membership (as owner), five accounts
--   (Hearth Bank as the hidden bank_source, Family Wallet, Rent, School
--   fees, Groceries), four account numbers (not the bank's), one access
--   code, one sign_up row in auth_attempts, and one session.
--
-- What it gives back:
--   {"customer_id": "<id>", "household_id": "<id>", "session_id": "<id>"}
--
-- Refusal codes (at the start of the message, before the colon):
--   bad_details        a typed detail is not in the allowed form
--   not_verified       the NIN or BVN ends in 99 (the simulated check fails)
--   under_18           the person is under 18 today in Lagos
--   bad_request        a value the server made, a limit, or a session
--                      value is not valid
--   limit_visitor      this visitor has reached the sign-ups-per-day limit
--   limit_daily        everyone together has reached today's limit
--   limit_total        the total number of customers has been reached
--   code_taken         the access code fingerprint is already in use
--   numbers_exhausted  no unused account number could be found
create function public.create_household(
  p_full_name text,
  p_phone text,
  p_date_of_birth date,
  p_role text,
  p_nin text,
  p_bvn text,
  p_household_name text,
  p_test_terms_accepted boolean,
  p_code_hash text,
  p_code_encrypted text,
  p_key_version integer,
  p_visitor_hash text,
  p_max_signups_per_visitor integer,
  p_max_customers_per_day integer,
  p_max_customers_total integer,
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
  v_household_name text;
  v_words text[];
  v_lagos_today date;
  v_lagos_midnight timestamptz;
  v_count bigint;
  v_household_id uuid;
  v_customer_id uuid;
  v_bank_id uuid;
  v_wallet_id uuid;
  v_rent_id uuid;
  v_school_id uuid;
  v_groceries_id uuid;
  v_session_id uuid;
begin
  -- -------------------------------------------------------------------
  -- 1. Check the typed details again. The server has already checked
  --    them; checking here as well means a mistake in the app can never
  --    store something it should not.
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

  -- Today's date as it is on a calendar in Lagos.
  v_lagos_today := (now() at time zone 'Africa/Lagos')::date;

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
  -- (Someone born on 29 February turns 18 on 1 March in a year that has
  -- no 29 February.)
  if p_date_of_birth > (v_lagos_today - interval '18 years')::date then
    raise exception 'under_18: The person must be 18 or over.'
      using errcode = 'check_violation';
  end if;

  -- The household name: at most 60 characters. When it is left empty, it
  -- becomes "<last word of the full name> household".
  v_household_name := btrim(coalesce(p_household_name, ''));
  if char_length(v_household_name) > 60 then
    raise exception 'bad_details: The household name must be at most 60 characters.'
      using errcode = 'check_violation';
  end if;
  if v_household_name = '' then
    v_words := regexp_split_to_array(v_full_name, '\s+');
    v_household_name := left(v_words[array_length(v_words, 1)], 50) || ' household';
  end if;

  -- -------------------------------------------------------------------
  -- 2. Check the values the server made, and the limits.
  -- -------------------------------------------------------------------
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_code_encrypted is null or char_length(p_code_encrypted) = 0
     or p_key_version is null or p_key_version < 1
     or p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request: A value made by the server is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_max_signups_per_visitor is null or p_max_signups_per_visitor < 0
     or p_max_customers_per_day is null or p_max_customers_per_day < 0
     or p_max_customers_total is null or p_max_customers_total < 0 then
    raise exception 'bad_request: Every limit must be a whole number of 0 or more.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The first session's values, with the same rules start_session uses:
  -- a 64-character fingerprint, at least 1 idle day, and an absolute
  -- length no shorter than the idle length.
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_idle_days is null or p_idle_days < 1
     or p_absolute_days is null or p_absolute_days < p_idle_days then
    raise exception 'bad_request: A session value is not in the expected form.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- -------------------------------------------------------------------
  -- 3. Take the sign-up lock, then count.
  --    Only one sign-up at a time gets past this line; the others wait
  --    here until it has finished. Without it, two sign-ups at the same
  --    instant could both count "2 of 3" and both go through. The lock is
  --    let go automatically when this save ends. (4207100 is simply the
  --    number FamilyFi uses to name this lock.)
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

  -- "Today" is the calendar day in Lagos, from midnight.
  v_lagos_midnight := v_lagos_today::timestamp at time zone 'Africa/Lagos';
  select count(*) into v_count
  from public.customers c
  where c.created_at >= v_lagos_midnight;
  if v_count >= p_max_customers_per_day then
    raise exception 'limit_daily: Today''s sign-up limit has been reached.'
      using errcode = 'program_limit_exceeded';
  end if;

  -- Customers are counted, not households, so households with no
  -- customer (such as the retired Adeyemi family) do not count.
  select count(*) into v_count
  from public.customers c;
  if v_count >= p_max_customers_total then
    raise exception 'limit_total: The total sign-up limit has been reached.'
      using errcode = 'program_limit_exceeded';
  end if;

  if exists (select 1 from public.access_codes ac where ac.code_hash = p_code_hash) then
    raise exception 'code_taken: That access code is already in use.'
      using errcode = 'unique_violation';
  end if;

  -- -------------------------------------------------------------------
  -- 4. Create everything.
  -- -------------------------------------------------------------------
  insert into public.households (name)
  values (v_household_name)
  returning id into v_household_id;

  insert into public.customers (
    full_name, phone, date_of_birth, role, nin, bvn,
    verification_status, verification_method, verified_at, test_terms_accepted_at
  )
  values (
    v_full_name, p_phone, p_date_of_birth, p_role, p_nin, p_bvn,
    'verified', 'simulated', now(), now()
  )
  returning id into v_customer_id;

  insert into public.household_members (household_id, customer_id, member_role)
  values (v_household_id, v_customer_id, 'owner');

  insert into public.accounts (household_id, name, kind)
  values (v_household_id, 'Hearth Bank', 'bank_source')
  returning id into v_bank_id;

  insert into public.accounts (household_id, name, kind)
  values (v_household_id, 'Family Wallet', 'wallet')
  returning id into v_wallet_id;

  insert into public.accounts (household_id, name, kind)
  values (v_household_id, 'Rent', 'pot')
  returning id into v_rent_id;

  insert into public.accounts (household_id, name, kind)
  values (v_household_id, 'School fees', 'pot')
  returning id into v_school_id;

  insert into public.accounts (household_id, name, kind)
  values (v_household_id, 'Groceries', 'pot')
  returning id into v_groceries_id;

  -- One account number for the wallet and each pot. The bank account
  -- gets none (and the account_numbers table refuses one for it).
  insert into public.account_numbers (account_id, account_number)
  values (v_wallet_id, public.new_account_number());
  insert into public.account_numbers (account_id, account_number)
  values (v_rent_id, public.new_account_number());
  insert into public.account_numbers (account_id, account_number)
  values (v_school_id, public.new_account_number());
  insert into public.account_numbers (account_id, account_number)
  values (v_groceries_id, public.new_account_number());

  insert into public.access_codes (customer_id, code_hash, code_encrypted, key_version)
  values (v_customer_id, p_code_hash, p_code_encrypted, p_key_version);

  -- -------------------------------------------------------------------
  -- 5. Count this sign-up, and clear counter rows older than 7 days.
  -- -------------------------------------------------------------------
  insert into public.auth_attempts (kind, visitor_hash)
  values ('sign_up', p_visitor_hash);

  perform public.clean_up_auth_attempts();

  -- -------------------------------------------------------------------
  -- 6. Sign the person in: their first session, in this same save, with
  --    the same lengths start_session would give.
  -- -------------------------------------------------------------------
  insert into public.sessions (customer_id, token_hash, idle_expires_at, absolute_expires_at)
  values (
    v_customer_id,
    p_token_hash,
    now() + make_interval(days => p_idle_days),
    now() + make_interval(days => p_absolute_days)
  )
  returning id into v_session_id;

  -- All balances start at ₦0.00: there are no entries yet.
  return jsonb_build_object(
    'customer_id', v_customer_id,
    'household_id', v_household_id,
    'session_id', v_session_id
  );
end;
$$;
