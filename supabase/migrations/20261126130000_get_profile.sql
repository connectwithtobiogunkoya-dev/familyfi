-- FamilyFi: the profile screen's details (Slice 5, migration 5)
--
-- This file adds:
--   * get_profile   what the profile screen shows for one person
--
-- It needs migrations 1 to 4 of Slice 5 to have been run first.
--
-- It runs in an ordinary Postgres: no extensions are used. Who may call
-- this function is set in 20261126130100_get_profile_grants.sql
-- (Supabase only).
--
-- The server calls it only with the customer id from the signed-in
-- person's own session, never one named by an address or a form.


-- ---------------------------------------------------------------------
-- THE PROFILE
-- ---------------------------------------------------------------------

-- get_profile: given a customer id, gives back what their profile screen
-- shows, and nothing more:
--   {
--     "full_name", "role", "phone", "member_role",
--     "household_name",
--     "verification_status", "verification_method", "verified_at",
--     "nin_last3", "bvn_last3",
--     "accounts": [{"name", "kind", "account_number"}, ...]
--   }
-- or nothing (null) if there is no such person, or they belong to no
-- household.
--
-- The household is found from the person's own membership, here inside
-- the function. It takes no household argument.
--
-- "accounts" lists the household's wallet and pots only, never its bank
-- account: the wallet first, then the pots in order of name. An account
-- with no test account number gives null for "account_number".
--
-- It never gives back:
--   * the full NIN or the full BVN: only the last 3 digits of each
--   * the date of birth
--   * the access code, its fingerprint or its locked copy
--   * any id: no customer id, household id or account id
--
-- It only reads, and changes nothing.
create function public.get_profile(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full_name text;
  v_role text;
  v_phone text;
  v_nin text;
  v_bvn text;
  v_verification_status text;
  v_verification_method text;
  v_verified_at timestamptz;
  v_member_role text;
  v_household_id uuid;
  v_household_name text;
  v_accounts jsonb;
begin
  if p_customer_id is null then
    return null;
  end if;

  select c.full_name, c.role, c.phone, c.nin, c.bvn,
         c.verification_status, c.verification_method, c.verified_at,
         m.member_role, h.id, h.name
    into v_full_name, v_role, v_phone, v_nin, v_bvn,
         v_verification_status, v_verification_method, v_verified_at,
         v_member_role, v_household_id, v_household_name
  from public.customers c
  join public.household_members m on m.customer_id = c.id
  join public.households h on h.id = m.household_id
  where c.id = p_customer_id;

  -- No such person, or no household: nothing.
  if v_household_id is null then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'name', a.name,
               'kind', a.kind,
               'account_number', n.account_number
             )
             order by (a.kind <> 'wallet'), a.name
           ),
           '[]'::jsonb
         )
    into v_accounts
  from public.accounts a
  left join public.account_numbers n on n.account_id = a.id
  where a.household_id = v_household_id
    and a.kind in ('wallet', 'pot');

  return jsonb_build_object(
    'full_name', v_full_name,
    'role', v_role,
    'phone', v_phone,
    'member_role', v_member_role,
    'household_name', v_household_name,
    'verification_status', v_verification_status,
    'verification_method', v_verification_method,
    'verified_at', v_verified_at,
    'nin_last3', right(v_nin, 3),
    'bvn_last3', right(v_bvn, 3),
    'accounts', v_accounts
  );
end;
$$;
