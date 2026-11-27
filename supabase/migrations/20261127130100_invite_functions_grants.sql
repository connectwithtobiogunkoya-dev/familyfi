-- FamilyFi: who may use the invite functions (Slice 6, migration 3)
--
-- SUPABASE ONLY. It names Supabase's roles, which do not exist in an
-- ordinary Postgres:
--   public         everyone, including roles created in the future
--   anon           visitors who are not signed in to Supabase
--   authenticated  people signed in to Supabase directly
--   service_role   the secret key, held only by FamilyFi's server code
--
-- It needs 20261127130000_invite_functions.sql to have been run first.
--
-- After this file, only service_role can run these functions. Visitors can
-- only create an invite, see it, join or list members by asking FamilyFi's
-- server, which calls them with the secret key, for the signed-in person
-- (or, for joining, the visitor) alone.


-- ---------------------------------------------------------------------
-- create_invite
-- ---------------------------------------------------------------------

revoke execute on function public.create_invite(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.create_invite(uuid, text, text, integer, integer)
  to service_role;


-- ---------------------------------------------------------------------
-- get_active_invite
-- ---------------------------------------------------------------------

revoke execute on function public.get_active_invite(uuid)
  from public, anon, authenticated;
grant execute on function public.get_active_invite(uuid)
  to service_role;


-- ---------------------------------------------------------------------
-- join_household
-- ---------------------------------------------------------------------

revoke execute on function public.join_household(
  text, text, date, text, text, text, boolean, text, text, text, integer, text,
  integer, integer, integer, integer, integer, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.join_household(
  text, text, date, text, text, text, boolean, text, text, text, integer, text,
  integer, integer, integer, integer, integer, text, integer, integer
) to service_role;


-- ---------------------------------------------------------------------
-- get_household_members
-- ---------------------------------------------------------------------

revoke execute on function public.get_household_members(uuid)
  from public, anon, authenticated;
grant execute on function public.get_household_members(uuid)
  to service_role;
