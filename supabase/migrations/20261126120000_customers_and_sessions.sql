-- FamilyFi: customers, households and sessions (Slice 5, migration 1)
--
-- This file adds the tables needed for people to sign up, belong to a
-- household, sign in and stay signed in. It creates tables and rules only.
-- Nothing in the app uses them yet, and nothing here moves money.
--
-- It needs the earlier migrations to have been run first, because it links
-- to the households and accounts tables.
--
-- It runs in an ordinary Postgres. Who may use these tables is set in a
-- later file, because the roles involved exist only on Supabase.
--
-- The ideas behind it:
--   * Phone, NIN and BVN are always test numbers: 11 digits starting with
--     000. A real number can never be stored, because the tables refuse it.
--   * A secret given to a browser (an access code, a session token) is
--     never stored as it is. The database keeps only its fingerprint (a
--     SHA-256 hash), plus, for the access code, a copy locked with a key
--     that only the server holds.
--   * Like the ledger, most of these rows can never be deleted, and can
--     only change in the few ways each table allows.


-- ---------------------------------------------------------------------
-- A SHARED GUARD
-- ---------------------------------------------------------------------

-- Refuses any attempt to change a row it is attached to. Used below on
-- every table, or every kind of change, that must never happen.
create function public.row_change_is_not_allowed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    '% on "%" is not allowed.',
    tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;


-- ---------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------

-- customers: one row per person who has signed up.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  date_of_birth date not null,
  role text not null,
  nin text not null,
  bvn text not null,
  verification_status text not null,
  verification_method text not null,
  verified_at timestamptz not null,
  test_terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),

  -- Rule: a name of 2 to 100 characters, with no spaces at either end.
  constraint customers_full_name_length
    check (full_name = btrim(full_name) and char_length(full_name) between 2 and 100),

  -- Rules: phone, NIN and BVN must each be a test number: exactly 11
  -- digits, starting with 000. No spaces, no +234, nothing else.
  -- No real Nigerian phone number starts 000, and FamilyFi only ever
  -- accepts NINs and BVNs in this clearly marked test pattern.
  constraint customers_phone_is_test_number
    check (phone ~ '^000[0-9]{8}$'),
  constraint customers_nin_is_test_number
    check (nin ~ '^000[0-9]{8}$'),
  constraint customers_bvn_is_test_number
    check (bvn ~ '^000[0-9]{8}$'),

  -- Rule: a NIN or BVN ending in 99 always fails the simulated identity
  -- check, so a customer who exists (and so passed) can never have one.
  constraint customers_nin_passed_check
    check (nin !~ '99$'),
  constraint customers_bvn_passed_check
    check (bvn !~ '99$'),

  -- Rule: the role is one of the two words, nothing else.
  constraint customers_role_allowed
    check (role in ('husband', 'wife')),

  -- Rules: only people whose simulated identity check passed are stored.
  constraint customers_verification_status_allowed
    check (verification_status = 'verified'),
  constraint customers_verification_method_allowed
    check (verification_method = 'simulated')
);

-- Rule: customers can never be edited or deleted, for now. A later slice
-- that needs to change a detail will relax this on purpose.
create trigger customers_no_update_or_delete
  before update or delete on public.customers
  for each row
  execute function public.row_change_is_not_allowed();

create trigger customers_no_truncate
  before truncate on public.customers
  for each statement
  execute function public.row_change_is_not_allowed();


-- ---------------------------------------------------------------------
-- HOUSEHOLD MEMBERS
-- ---------------------------------------------------------------------

-- household_members: who belongs to which household. Each person belongs
-- to exactly one household. A partner will join in a later slice.
create table public.household_members (
  household_id uuid not null references public.households (id),
  customer_id uuid not null references public.customers (id),
  member_role text not null,
  joined_at timestamptz not null default now(),

  primary key (household_id, customer_id),

  -- Rule: a person belongs to one household only.
  constraint household_members_one_household_per_customer
    unique (customer_id),

  -- Rule: the member's place in the household is one of these words.
  constraint household_members_role_allowed
    check (member_role in ('owner', 'partner'))
);

-- Rule: a household has exactly one owner at most.
create unique index household_members_one_owner_per_household
  on public.household_members (household_id)
  where member_role = 'owner';

-- A lookup aid: "who is in this household" is fast to find.
create index household_members_household_id_idx
  on public.household_members (household_id);

-- Rule: a membership can never be deleted.
create trigger household_members_no_delete
  before delete on public.household_members
  for each row
  execute function public.row_change_is_not_allowed();

create trigger household_members_no_truncate
  before truncate on public.household_members
  for each statement
  execute function public.row_change_is_not_allowed();

-- Rule: a membership can never be moved to another household or another
-- person. Moving someone between households would let them see another
-- family's money. (The member_role may still change, for the partner
-- slice.)
create function public.household_member_identity_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.customer_id is distinct from old.customer_id
     or new.joined_at is distinct from old.joined_at then
    raise exception
      'A membership''s household, person and joining time cannot be changed.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger household_members_identity_fixed
  before update on public.household_members
  for each row
  execute function public.household_member_identity_is_fixed();


-- ---------------------------------------------------------------------
-- ACCESS CODES
-- ---------------------------------------------------------------------

-- access_codes: one per person. The code itself is never stored as it is.
--   code_hash       its fingerprint (SHA-256, 64 hexadecimal characters),
--                   used to find the person when they sign in
--   code_encrypted  the code locked with a key only the server holds, so
--                   it can be shown to the person again on their profile
--   key_version     which version of that server key locked it, so the
--                   key can be changed later and old codes re-locked
create table public.access_codes (
  customer_id uuid primary key references public.customers (id),
  code_hash text not null,
  code_encrypted text not null,
  key_version integer not null,
  created_at timestamptz not null default now(),

  -- Rule: no two people can have the same code.
  constraint access_codes_code_hash_unique
    unique (code_hash),

  -- Rule: the fingerprint is exactly 64 lowercase hexadecimal characters.
  constraint access_codes_code_hash_format
    check (code_hash ~ '^[0-9a-f]{64}$'),

  -- Rule: the locked copy is never empty.
  constraint access_codes_code_encrypted_not_empty
    check (char_length(code_encrypted) > 0),

  -- Rule: key versions start at 1.
  constraint access_codes_key_version_positive
    check (key_version >= 1)
);

-- Rule: an access code can never be deleted.
create trigger access_codes_no_delete
  before delete on public.access_codes
  for each row
  execute function public.row_change_is_not_allowed();

create trigger access_codes_no_truncate
  before truncate on public.access_codes
  for each statement
  execute function public.row_change_is_not_allowed();

-- Rule: only the locked copy and its key version may change (when the key
-- is changed and the code re-locked). Whose code it is, the code's
-- fingerprint and when it was made can never change.
create function public.access_code_identity_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is distinct from old.customer_id
     or new.code_hash is distinct from old.code_hash
     or new.created_at is distinct from old.created_at then
    raise exception
      'Only an access code''s locked copy and key version can be changed.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger access_codes_identity_fixed
  before update on public.access_codes
  for each row
  execute function public.access_code_identity_is_fixed();


-- ---------------------------------------------------------------------
-- SESSIONS
-- ---------------------------------------------------------------------

-- sessions: one row per signed-in browser. The browser holds a random
-- token in a cookie; the database keeps only the token's fingerprint.
--   idle_expires_at      when the session ends if it is not used
--   absolute_expires_at  when it ends no matter what
--   ended_at             set when the person signs out
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  ended_at timestamptz,

  -- Rule: no two sessions share a token.
  constraint sessions_token_hash_unique
    unique (token_hash),

  -- Rule: the fingerprint is exactly 64 lowercase hexadecimal characters.
  constraint sessions_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Rules: the times make sense together. A session ends after it began,
  -- and the idle limit can never reach past the absolute limit.
  constraint sessions_absolute_after_created
    check (absolute_expires_at > created_at),
  constraint sessions_idle_within_absolute
    check (idle_expires_at <= absolute_expires_at),
  constraint sessions_ended_after_created
    check (ended_at is null or ended_at >= created_at)
);

-- A lookup aid: "this person's sessions" is fast to find.
create index sessions_customer_id_idx on public.sessions (customer_id);

-- Rule: a session can never be deleted. Signing out marks it as ended.
create trigger sessions_no_delete
  before delete on public.sessions
  for each row
  execute function public.row_change_is_not_allowed();

create trigger sessions_no_truncate
  before truncate on public.sessions
  for each statement
  execute function public.row_change_is_not_allowed();

-- Rule: only last_used_at, idle_expires_at and ended_at may change, and
-- once a session has ended it stays ended: ended_at can be set once and
-- never changed or cleared.
create function public.session_changes_are_limited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.customer_id is distinct from old.customer_id
     or new.token_hash is distinct from old.token_hash
     or new.created_at is distinct from old.created_at
     or new.absolute_expires_at is distinct from old.absolute_expires_at then
    raise exception
      'Only a session''s last use, idle limit and end time can be changed.'
      using errcode = 'restrict_violation';
  end if;

  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
    raise exception
      'A session that has ended stays ended.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger sessions_changes_limited
  before update on public.sessions
  for each row
  execute function public.session_changes_are_limited();


-- ---------------------------------------------------------------------
-- ACCOUNT NUMBERS
-- ---------------------------------------------------------------------

-- account_numbers: one 10-digit test account number for each wallet and
-- pot. The household's bank account gets none. The numbers are made in a
-- later file (with the CBN NUBAN check digit and the bank code 000).
create table public.account_numbers (
  account_id uuid primary key references public.accounts (id),
  account_number text not null,
  created_at timestamptz not null default now(),

  -- Rule: no two accounts share a number.
  constraint account_numbers_number_unique
    unique (account_number),

  -- Rule: exactly 10 digits, nothing else.
  constraint account_numbers_number_format
    check (account_number ~ '^[0-9]{10}$')
);

-- Rule: a bank_source account never gets an account number. An account's
-- kind can never change (see accounts_identity_fixed in the ledger
-- migration), so checking when the number is added is enough.
-- "security definer" lets the check always see the account, whoever adds
-- the number.
create function public.account_number_not_for_bank_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  select a.kind into v_kind
  from public.accounts a
  where a.id = new.account_id;

  if v_kind is null then
    raise exception
      'Account % does not exist.', new.account_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_kind = 'bank_source' then
    raise exception
      'A bank_source account cannot have an account number.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger account_numbers_not_for_bank_source
  before insert on public.account_numbers
  for each row
  execute function public.account_number_not_for_bank_source();

-- Rule: an account number can never be edited or deleted.
create trigger account_numbers_no_update_or_delete
  before update or delete on public.account_numbers
  for each row
  execute function public.row_change_is_not_allowed();

create trigger account_numbers_no_truncate
  before truncate on public.account_numbers
  for each statement
  execute function public.row_change_is_not_allowed();


-- ---------------------------------------------------------------------
-- AUTH ATTEMPTS
-- ---------------------------------------------------------------------

-- auth_attempts: a counter for the limits on sign-ups and wrong access
-- codes. Each row is one sign-up, or one wrong access code, from one
-- visitor. The visitor is recorded only as a fingerprint of their
-- internet address, never the address itself.
-- This table is not part of the ledger. Rows older than 7 days are
-- cleared by a function added in a later file.
create table public.auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  visitor_hash text not null,
  created_at timestamptz not null default now(),

  -- Rule: the kind is one of the two words, nothing else.
  constraint auth_attempts_kind_allowed
    check (kind in ('sign_up', 'sign_in_failed')),

  -- Rule: the fingerprint is exactly 64 lowercase hexadecimal characters.
  constraint auth_attempts_visitor_hash_format
    check (visitor_hash ~ '^[0-9a-f]{64}$')
);

-- Lookup aids: counting one visitor's recent attempts, and counting
-- everyone's attempts of one kind, are both fast.
create index auth_attempts_visitor_idx
  on public.auth_attempts (kind, visitor_hash, created_at);
create index auth_attempts_kind_created_idx
  on public.auth_attempts (kind, created_at);


-- ---------------------------------------------------------------------
-- ACCESS: LOCKED BY DEFAULT
-- ---------------------------------------------------------------------

-- Row Level Security is switched on for every new table, and no access
-- policies are created, exactly as for the ledger tables. Nothing can be
-- read or written through the public API until a later step allows it on
-- purpose.
alter table public.customers enable row level security;
alter table public.household_members enable row level security;
alter table public.access_codes enable row level security;
alter table public.sessions enable row level security;
alter table public.account_numbers enable row level security;
alter table public.auth_attempts enable row level security;
