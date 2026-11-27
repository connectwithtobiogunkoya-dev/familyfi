-- FamilyFi: who may use post_transaction_by (Slice 6, migration 5)
--
-- SUPABASE ONLY. It names Supabase's roles, which do not exist in an
-- ordinary Postgres:
--   public         everyone, including roles created in the future
--   anon           visitors who are not signed in to Supabase
--   authenticated  people signed in to Supabase directly
--   service_role   the secret key, held only by FamilyFi's server code
--
-- It needs 20261127140000_transaction_made_by.sql to have been run first.
--
-- post_transaction's own grants are not touched: only service_role can
-- run it, exactly as before.


-- ---------------------------------------------------------------------
-- post_transaction_by
-- ---------------------------------------------------------------------

-- After this, only service_role can run it. A person can only move money
-- by asking FamilyFi's server, which takes who they are from their
-- session before it calls this function.
revoke execute on function public.post_transaction_by(uuid, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.post_transaction_by(uuid, text, text, jsonb, uuid)
  to service_role;


-- ---------------------------------------------------------------------
-- The rule function
-- ---------------------------------------------------------------------

-- It runs only as a trigger, so nobody needs to call it directly. The
-- right is taken from public, anon and authenticated. service_role may
-- still hold it through Supabase's own defaults; that is harmless,
-- because Postgres refuses to run a trigger function except as a trigger.
revoke execute on function public.transaction_creator_is_member()
  from public, anon, authenticated;
