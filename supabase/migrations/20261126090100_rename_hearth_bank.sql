-- FamilyFi: rename the demo family's bank account
--
-- The demo family's bank_source account was created by supabase/seed.sql
-- with the name "Hearth Bank (fake)". This file renames it to
-- "Hearth Bank", so the word "fake" does not appear on screen when the
-- account is shown on the Add money screen and in statements.
--
-- It needs both earlier migrations and the seed file to have been run
-- first. If the seed was never run, this changes nothing.
--
-- Is a rename allowed? Yes. The rule accounts_identity_fixed (in
-- 20261112120000_ledger_tables.sql) refuses any change to an account's
-- household or kind, and lets every other change through. Only the name
-- changes here, so the rule allows it without being switched off.
--
-- Nothing about money changes: the account keeps its id, its household,
-- its kind and every one of its entries. Its balance is unchanged.

-- Rename exactly one account: the seed's bank account, picked out by its
-- fixed id, and only while it still has the old name. Running this file a
-- second time finds nothing to rename and changes nothing.
update public.accounts
set name = 'Hearth Bank'
where id = 'b0000000-0000-4000-8000-000000000001'
  and name = 'Hearth Bank (fake)';
