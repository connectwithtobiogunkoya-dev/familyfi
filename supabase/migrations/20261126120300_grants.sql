-- FamilyFi: who may use the Slice 5 tables and functions (migration 4)
--
-- SUPABASE ONLY. This is the one Slice 5 file that names Supabase's roles:
--   public         everyone, including roles created in the future
--   anon           visitors who are not signed in to Supabase
--   authenticated  people signed in to Supabase directly
--   service_role   the secret key, held only by FamilyFi's server code
-- In an ordinary Postgres these roles do not exist, so this file would
-- fail there. The other Slice 5 files do not need it to be tested.
--
-- It needs migrations 1, 2 and 3 of Slice 5 to have been run first.
--
-- Why it is needed: Postgres lets everyone run a new function unless told
-- otherwise, and Supabase also hands new tables and functions to anon and
-- authenticated by default. Row Level Security already stops those roles
-- reading the tables, but taking the permissions away as well means two
-- locks instead of one.
--
-- After this file:
--   * Only service_role can run the Slice 5 functions. Visitors can only
--     sign up, sign in or be recognised by asking FamilyFi's server, which
--     calls these functions with the secret key.
--   * anon and authenticated have nothing on the Slice 5 tables.


-- ---------------------------------------------------------------------
-- FUNCTIONS THE SERVER CALLS
-- ---------------------------------------------------------------------

-- Migration 2: creating a household, and its helpers.
revoke execute on function public.nuban_check_digit(text, text)
  from public, anon, authenticated;
grant execute on function public.nuban_check_digit(text, text)
  to service_role;

revoke execute on function public.new_account_number()
  from public, anon, authenticated;
grant execute on function public.new_account_number()
  to service_role;

revoke execute on function public.clean_up_auth_attempts()
  from public, anon, authenticated;
grant execute on function public.clean_up_auth_attempts()
  to service_role;

revoke execute on function public.create_household(
  text, text, date, text, text, text, text, boolean, text, text, integer, text, integer, integer, integer,
  text, integer, integer
) from public, anon, authenticated;
grant execute on function public.create_household(
  text, text, date, text, text, text, text, boolean, text, text, integer, text, integer, integer, integer,
  text, integer, integer
) to service_role;

-- Migration 3: sessions and sign-in.
revoke execute on function public.start_session(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_session(uuid, text, integer, integer)
  to service_role;

revoke execute on function public.sign_in_with_code(text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.sign_in_with_code(text, text, text, integer, integer, integer, integer)
  to service_role;

revoke execute on function public.get_session(text)
  from public, anon, authenticated;
grant execute on function public.get_session(text)
  to service_role;

revoke execute on function public.end_session(text)
  from public, anon, authenticated;
grant execute on function public.end_session(text)
  to service_role;

revoke execute on function public.get_access_code_material(uuid)
  from public, anon, authenticated;
grant execute on function public.get_access_code_material(uuid)
  to service_role;


-- ---------------------------------------------------------------------
-- RULE FUNCTIONS (from migration 1)
-- ---------------------------------------------------------------------

-- These run only as triggers, when a row changes. Nobody needs to call
-- them directly, so nobody is given that right, not even service_role.
-- (Postgres checks this right only when a trigger is created, not each
-- time it fires, so taking it away does not stop the rules working.)
revoke execute on function public.row_change_is_not_allowed()
  from public, anon, authenticated;
revoke execute on function public.household_member_identity_is_fixed()
  from public, anon, authenticated;
revoke execute on function public.access_code_identity_is_fixed()
  from public, anon, authenticated;
revoke execute on function public.session_changes_are_limited()
  from public, anon, authenticated;
revoke execute on function public.account_number_not_for_bank_source()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- TABLES (from migration 1)
-- ---------------------------------------------------------------------

-- Nothing on these tables for anon or authenticated: no reading, adding,
-- changing or removing. The server reaches them only through the
-- functions above.
revoke all on table public.customers from public, anon, authenticated;
revoke all on table public.household_members from public, anon, authenticated;
revoke all on table public.access_codes from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on table public.account_numbers from public, anon, authenticated;
revoke all on table public.auth_attempts from public, anon, authenticated;

-- auth_attempts numbers its rows with a counter (a sequence). Nothing on
-- that counter either.
revoke all on sequence public.auth_attempts_id_seq from public, anon, authenticated;
