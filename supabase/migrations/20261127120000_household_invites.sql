-- FamilyFi: invite codes for a partner to join a household (Slice 6, migration 1)
--
-- This file adds the tables and rules for inviting a partner. It creates
-- no functions that the app calls: those come in the next file. Nothing
-- here moves money.
--
-- It needs every Slice 5 migration to have been run first, because it
-- links to households and customers and changes two Slice 5 tables.
--
-- SUPABASE ONLY at the end: the last section names Supabase's roles
-- (anon, authenticated, service_role), which do not exist in an ordinary
-- Postgres. Everything before that section is ordinary Postgres.
--
-- The ideas behind it:
--   * An invite code is a secret given to a person, like an access code.
--     The database keeps only its fingerprint (a SHA-256 hash), plus a
--     copy locked with the server's ACCESS_CODE_ENCRYPTION_KEY, so the
--     owner can see an unused code again. That locked copy is wiped as soon
--     as the invite is used or voided, so a finished code can never be
--     shown again.
--   * A household has at most one invite that can still be used, and at
--     most two members: one owner and one partner.
--   * Like the other Slice 5 tables, invite rows are never deleted, and
--     can only change in the few ways allowed below.


-- ---------------------------------------------------------------------
-- HOUSEHOLD INVITES
-- ---------------------------------------------------------------------

-- household_invites: one row for every invite code an owner creates.
--   household_id    the household the code lets a partner join
--   created_by      the owner who created it
--   code_hash       the code's fingerprint (SHA-256, 64 hexadecimal
--                   characters), used to find the invite when a partner
--                   types the code
--   code_encrypted  the code locked with the server's key, so the owner
--                   can see it again while it is unused; null once the
--                   invite is used, voided, or found past its time and
--                   cleaned
--   key_version     which version of the server's key locked it; null
--                   exactly when code_encrypted is null
--   created_at      when it was created
--   expires_at      48 hours after created_at, set by the database
--   used_at         when a partner joined with it
--   used_by         the partner it made
--   voided_at       when it was stopped, because the owner created a newer
--                   code or because it was found past its time
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  created_by uuid not null references public.customers (id),
  code_hash text not null,
  code_encrypted text,
  key_version integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  used_at timestamptz,
  used_by uuid references public.customers (id),
  voided_at timestamptz,

  -- Rule: no two invites share a code.
  constraint household_invites_code_hash_unique
    unique (code_hash),

  -- Rule: the fingerprint is exactly 64 lowercase hexadecimal characters.
  constraint household_invites_code_hash_format
    check (code_hash ~ '^[0-9a-f]{64}$'),

  -- Rule: an invite lasts exactly 48 hours from when it was created. The
  -- default above sets it; this rule stops any other time being written.
  -- (now() is the same moment for both defaults within one save.)
  constraint household_invites_lasts_48_hours
    check (expires_at = created_at + interval '48 hours'),

  -- Rule: the locked copy and its key version go together: both there,
  -- or both gone.
  constraint household_invites_copy_and_version_together
    check ((code_encrypted is null) = (key_version is null)),

  -- Rule: a locked copy that is there is never empty, and key versions
  -- start at 1.
  constraint household_invites_copy_not_empty
    check (code_encrypted is null or char_length(code_encrypted) > 0),
  constraint household_invites_key_version_positive
    check (key_version is null or key_version >= 1),

  -- Rule: an invite is used or voided, never both.
  constraint household_invites_not_used_and_voided
    check (used_at is null or voided_at is null),

  -- Rule: once an invite is used or voided, its locked copy is gone, so a
  -- finished code can never be shown again.
  constraint household_invites_copy_gone_when_finished
    check ((used_at is null and voided_at is null) or code_encrypted is null),

  -- Rule: the time it was used and the partner it made are recorded
  -- together: both, or neither.
  constraint household_invites_used_together
    check ((used_at is null) = (used_by is null)),

  -- Rule: the person who joins is never the owner who invited them.
  constraint household_invites_used_by_not_creator
    check (used_by is null or used_by <> created_by),

  -- Rule: an invite cannot be used or voided before it was created.
  constraint household_invites_used_after_created
    check (used_at is null or used_at >= created_at),
  constraint household_invites_voided_after_created
    check (voided_at is null or voided_at >= created_at)
);

-- Rule: a household has at most one ACTIVE invite: one that is neither
-- used nor voided.
--
-- An index cannot also test "not past its time", because now() is not
-- allowed in an index (its answer changes from moment to moment). So an
-- invite past its time but never voided still counts as active here. The
-- function that creates invites (create_invite, in the next file) must
-- therefore void the household's older unused invite, expired or not,
-- before it inserts a new one, in the same save. Every function that
-- reads an invite must also treat one past its time as not usable.
create unique index household_invites_one_active_per_household
  on public.household_invites (household_id)
  where used_at is null and voided_at is null;

-- Lookup aid: counting a household's invites in the last 24 hours (the
-- limit of 10 a day) is fast.
create index household_invites_household_created_idx
  on public.household_invites (household_id, created_at);

-- Rule: invites can never be deleted or truncated. They are a record of
-- who was invited and when.
create trigger household_invites_no_delete
  before delete on public.household_invites
  for each row
  execute function public.row_change_is_not_allowed();

create trigger household_invites_no_truncate
  before truncate on public.household_invites
  for each statement
  execute function public.row_change_is_not_allowed();

-- Rule: only the household's owner can create an invite. The person in
-- created_by must belong to that household, as its owner. This is the
-- database's own wall: the app's screen hiding the button is only the
-- polite one.
create function public.household_invite_creator_is_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.household_members m
    where m.household_id = new.household_id
      and m.customer_id = new.created_by
      and m.member_role = 'owner'
  ) then
    raise exception
      'Only the household''s owner can create an invite.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger household_invites_creator_is_owner
  before insert on public.household_invites
  for each row
  execute function public.household_invite_creator_is_owner();

-- Rule: an invite can change in only three ways, each of them once:
--   * its locked copy (and key version) can be cleared, never set again
--     or changed to something else
--   * it can be marked used (used_at and used_by), once, and the person
--     must then be a partner in that same household
--   * it can be marked voided (voided_at), once
-- Nothing else about it can ever change: not its household, owner, code,
-- creation time or end time.
create function public.household_invite_changes_are_limited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.household_id is distinct from old.household_id
     or new.created_by is distinct from old.created_by
     or new.code_hash is distinct from old.code_hash
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception
      'An invite''s household, owner, code and times cannot be changed.'
      using errcode = 'restrict_violation';
  end if;

  -- The locked copy can only be cleared.
  if (new.code_encrypted is distinct from old.code_encrypted and new.code_encrypted is not null)
     or (new.key_version is distinct from old.key_version and new.key_version is not null) then
    raise exception
      'An invite''s locked copy can only be cleared, never changed.'
      using errcode = 'restrict_violation';
  end if;

  -- Used: set once, never changed or cleared.
  if old.used_at is not null
     and (new.used_at is distinct from old.used_at or new.used_by is distinct from old.used_by) then
    raise exception
      'An invite that has been used stays used.'
      using errcode = 'restrict_violation';
  end if;

  -- Voided: set once, never changed or cleared.
  if old.voided_at is not null and new.voided_at is distinct from old.voided_at then
    raise exception
      'An invite that has been voided stays voided.'
      using errcode = 'restrict_violation';
  end if;

  -- When it is marked used, the person must now be a partner in the same
  -- household (the function that joins adds the membership first, in the
  -- same save).
  if old.used_at is null and new.used_at is not null
     and not exists (
       select 1
       from public.household_members m
       where m.household_id = new.household_id
         and m.customer_id = new.used_by
         and m.member_role = 'partner'
     ) then
    raise exception
      'An invite can only be marked used by a partner of its own household.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger household_invites_changes_limited
  before update on public.household_invites
  for each row
  execute function public.household_invite_changes_are_limited();


-- ---------------------------------------------------------------------
-- HOUSEHOLD MEMBERS: AT MOST ONE PARTNER
-- ---------------------------------------------------------------------

-- Rule: a household has at most one partner. Together with the existing
-- rule of at most one owner (household_members_one_owner_per_household),
-- and member_role being only owner or partner, a household can never have
-- more than two members. There is no rule about Husband or Wife: either
-- person may choose either role.
create unique index household_members_one_partner_per_household
  on public.household_members (household_id)
  where member_role = 'partner';


-- ---------------------------------------------------------------------
-- AUTH ATTEMPTS: A THIRD KIND, FOR WRONG INVITE CODES
-- ---------------------------------------------------------------------

-- auth_attempts counted two kinds until now: sign_up and sign_in_failed.
-- Wrong invite codes are counted as a third kind, invite_failed, separately
-- from wrong access codes, so a person who mistypes one is not locked out
-- of the other.
--
-- The old rule (auth_attempts_kind_allowed) is replaced by one that allows
-- all three. Every existing row has one of the first two kinds, so it
-- still passes. Both changes happen in one statement, so there is no
-- moment without a rule.
alter table public.auth_attempts
  drop constraint auth_attempts_kind_allowed,
  add constraint auth_attempts_kind_allowed
    check (kind in ('sign_up', 'sign_in_failed', 'invite_failed'));


-- ---------------------------------------------------------------------
-- ACCESS: LOCKED BY DEFAULT
-- ---------------------------------------------------------------------

-- Row Level Security on, with no access policies, exactly as for every
-- other table. Nothing can be read or written through the public API.
alter table public.household_invites enable row level security;


-- ---------------------------------------------------------------------
-- WHO MAY USE IT (SUPABASE ONLY)
-- ---------------------------------------------------------------------

-- Nothing on this table for anon or authenticated: no reading, adding,
-- changing or removing. service_role (the secret key, held only by
-- FamilyFi's server) may read, add and change rows; it is never given
-- delete or truncate, and the rules above refuse those anyway. The app
-- will reach this table only through the functions in the next file.
revoke all on table public.household_invites from public, anon, authenticated;
revoke all on table public.household_invites from service_role;
grant select, insert, update on table public.household_invites to service_role;

-- The rule functions run only as triggers. Nobody needs to call them
-- directly, so the right is taken from public, anon and authenticated.
-- service_role may still hold it through Supabase's own defaults; that is
-- harmless, because Postgres refuses to run a trigger function except as
-- a trigger. (Comment reworded after this file was run; the SQL is
-- unchanged.)
revoke execute on function public.household_invite_creator_is_owner()
  from public, anon, authenticated;
revoke execute on function public.household_invite_changes_are_limited()
  from public, anon, authenticated;
