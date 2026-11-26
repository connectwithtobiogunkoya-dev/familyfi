-- FamilyFi: who may use get_profile (Slice 5, migration 6)
--
-- SUPABASE ONLY. It names Supabase's roles, which do not exist in an
-- ordinary Postgres:
--   public         everyone, including roles created in the future
--   anon           visitors who are not signed in to Supabase
--   authenticated  people signed in to Supabase directly
--   service_role   the secret key, held only by FamilyFi's server code
--
-- It needs 20261126130000_get_profile.sql to have been run first.
--
-- After this file, only service_role can run get_profile: a visitor can
-- see a profile only by asking FamilyFi's server, which calls it with the
-- secret key for the signed-in person alone.

revoke execute on function public.get_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.get_profile(uuid)
  to service_role;
