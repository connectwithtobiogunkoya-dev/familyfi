-- FamilyFi: demo data
--
-- THIS IS DEMO DATA WITH FAKE MONEY. No real bank, no real naira.
-- It puts one pretend family into the database so the app has something
-- to show.
--
-- This file will NOT work until both migration files have been run:
--   supabase/migrations/20261112120000_ledger_tables.sql
--   supabase/migrations/20261112120100_post_transaction.sql
--
-- It is safe to run this file more than once. The second time, nothing
-- new is added and no money moves again.
--
-- Amounts are in kobo. 100 kobo = 1 naira, so 10,000,000 kobo = 100,000 naira.


-- ---------------------------------------------------------------------
-- 1. The household
-- ---------------------------------------------------------------------
-- One pretend family. The long code is its id. It is written out here
-- (instead of letting the database invent one) so that it is the same
-- every time this file runs, and the lines below can refer to it.
-- "on conflict do nothing" means: if this row is already there, skip it
-- quietly instead of failing.
insert into public.households (id, name)
values ('a0000000-0000-4000-8000-000000000001', 'The Adeyemi Family')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- 2. The accounts
-- ---------------------------------------------------------------------
-- Five places money can sit, all belonging to the family above:
--   * a pretend bank, which stands for the outside world
--   * the shared family wallet
--   * three labelled pots
-- Each has a fixed id, for the same reason as the household.
insert into public.accounts (id, household_id, name, kind)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Hearth Bank (fake)', 'bank_source'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Family Wallet',      'wallet'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Rent',               'pot'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'School fees',        'pot'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'Groceries',          'pot')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- 3. The money
-- ---------------------------------------------------------------------
-- Every movement goes through post_transaction, the one front door to
-- the ledger. Nothing is written into the transactions or entries tables
-- directly.
-- Each movement has two lines that cancel out: a minus on the account
-- the money leaves, and the same plus on the account it arrives in.
-- Each one also carries a unique label (the idempotency key). If this
-- file runs again, post_transaction recognises the label, sees the same
-- lines, and answers "already done" without moving anything.

-- 3a. Fund the wallet from the pretend bank: 10,000,000 kobo (100,000 naira).
--     The bank goes to minus 10,000,000. That is allowed for a bank_source,
--     because it stands for money coming in from outside.
select public.post_transaction(
  'a0000000-0000-4000-8000-000000000001',
  'Fund the family wallet from the bank',
  'seed-fund-wallet',
  '[
    {"account_id": "b0000000-0000-4000-8000-000000000001", "amount_kobo": -10000000},
    {"account_id": "b0000000-0000-4000-8000-000000000002", "amount_kobo": 10000000}
  ]'::jsonb
);

-- 3b. Move 4,000,000 kobo (40,000 naira) from the wallet to the Rent pot.
select public.post_transaction(
  'a0000000-0000-4000-8000-000000000001',
  'Set aside money for rent',
  'seed-rent-pot',
  '[
    {"account_id": "b0000000-0000-4000-8000-000000000002", "amount_kobo": -4000000},
    {"account_id": "b0000000-0000-4000-8000-000000000003", "amount_kobo": 4000000}
  ]'::jsonb
);

-- 3c. Move 3,000,000 kobo (30,000 naira) from the wallet to the School fees pot.
select public.post_transaction(
  'a0000000-0000-4000-8000-000000000001',
  'Set aside money for school fees',
  'seed-school-fees-pot',
  '[
    {"account_id": "b0000000-0000-4000-8000-000000000002", "amount_kobo": -3000000},
    {"account_id": "b0000000-0000-4000-8000-000000000004", "amount_kobo": 3000000}
  ]'::jsonb
);

-- 3d. Move 1,500,000 kobo (15,000 naira) from the wallet to the Groceries pot.
select public.post_transaction(
  'a0000000-0000-4000-8000-000000000001',
  'Set aside money for groceries',
  'seed-groceries-pot',
  '[
    {"account_id": "b0000000-0000-4000-8000-000000000002", "amount_kobo": -1500000},
    {"account_id": "b0000000-0000-4000-8000-000000000005", "amount_kobo": 1500000}
  ]'::jsonb
);


-- ---------------------------------------------------------------------
-- 4. The result
-- ---------------------------------------------------------------------
-- Show every account of the demo family with its balance, worked out
-- live from the entries. Expected, in kobo:
--   Family Wallet         1,500,000
--   Groceries             1,500,000
--   Hearth Bank (fake)  -10,000,000
--   Rent                  4,000,000
--   School fees           3,000,000
-- These add up to zero, as they always must.
select account_id, name, kind, balance_kobo
from public.account_balances
where household_id = 'a0000000-0000-4000-8000-000000000001'
order by name;
