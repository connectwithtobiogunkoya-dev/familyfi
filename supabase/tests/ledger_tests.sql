-- FamilyFi: ledger tests
--
-- A self-checking test file. Run it once in the Supabase SQL editor,
-- after both migration files and the seed file.
--
-- IT LEAVES NO TRACE. Everything below happens inside one database
-- transaction, and the file ends with a deliberate error that carries the
-- test report. That error also discards everything the file did. No test
-- family, no test money and no results stay behind.
--
-- WHAT THESE TESTS CANNOT CHECK
--   * Two people acting at the same instant. That needs two separate
--     database connections working at once. It is planned for a later
--     slice. So the overdraft lock itself is NOT proven by this file.
--   * Row Level Security as a signed-in user. This file runs as the
--     admin, who is allowed past those locks, so it cannot show what an
--     ordinary user would or would not see.
--
-- HOW EACH TEST WORKS
--   * A test that must be REFUSED tries the bad action. If the database
--     refuses it with the message we expect, the test records "pass". If
--     the action is allowed, or is refused for some other reason, it
--     records "FAIL". Either way, whatever the test wrote is undone, and
--     the next test still runs.
--   * A test that must WORK does the action and checks the outcome.
--   * The "detail" column shows what the database actually said.
--
-- THE TEST FAMILY (never the seed family)
--   Household A (main)   c0000000-0000-4000-8000-000000000001
--   Household B (other)  c0000000-0000-4000-8000-000000000002
--   Test Bank            d0000000-0000-4000-8000-000000000001  bank_source, household A
--   Test Wallet          d0000000-0000-4000-8000-000000000002  wallet,      household A
--   Test Pot             d0000000-0000-4000-8000-000000000003  pot,         household A
--   Spare Pot            d0000000-0000-4000-8000-000000000004  pot,         household A
--   Other Family Pot     d0000000-0000-4000-8000-000000000009  pot,         household B

begin;

-- ---------------------------------------------------------------------
-- SETUP
-- ---------------------------------------------------------------------

-- The scoreboard. A temporary table exists only while this file runs.
create temporary table test_results (
  id integer generated always as identity,
  test_name text not null,
  result text not null,
  detail text
) on commit drop;

-- Two test households, with ids different from the seed family's.
insert into public.households (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Test Household A'),
  ('c0000000-0000-4000-8000-000000000002', 'Test Household B');

-- The test accounts.
insert into public.accounts (id, household_id, name, kind) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Test Bank',        'bank_source'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Test Wallet',      'wallet'),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Test Pot',         'pot'),
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Spare Pot',        'pot'),
  ('d0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000002', 'Other Family Pot', 'pot');


-- ---------------------------------------------------------------------
-- LEDGER RULES (through post_transaction)
-- ---------------------------------------------------------------------

-- Test 1: funding the wallet works.
-- Move 1,000 kobo from the test bank into the test wallet, then check
-- that the wallet really shows 1,000.
do $$
declare
  v_result jsonb;
  v_balance bigint;
begin
  v_result := public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: fund the wallet',
    'test-fund',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -1000},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 1000}]'::jsonb
  );

  select balance_kobo into v_balance
  from public.account_balances
  where account_id = 'd0000000-0000-4000-8000-000000000002';

  insert into test_results (test_name, result, detail)
  values ('funding the wallet works',
          case when (v_result ->> 'replayed') = 'false' and v_balance = 1000 then 'pass' else 'FAIL' end,
          format('answer: %s, wallet balance: %s (expected 1000)', v_result, v_balance));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('funding the wallet works', 'FAIL', sqlerrm);
end $$;

-- Test 2: an unbalanced transaction is refused.
-- 500 leaves the bank but only 400 arrives. 100 kobo would vanish.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: unbalanced',
    'test-unbalanced',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -500},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 400}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('an unbalanced transaction is refused',
          case when sqlerrm like '%does not balance%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 3: a transaction with a single entry is refused.
-- Money leaves the bank and goes nowhere.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: single entry',
    'test-single-entry',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -500}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a transaction with a single entry is refused',
          case when sqlerrm like '%at least two entries%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 4: an overdraft from a wallet is refused.
-- The wallet holds 1,000. Try to take 2,000 out of it.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: wallet overdraft',
    'test-wallet-overdraft',
    '[{"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": -2000},
      {"account_id": "d0000000-0000-4000-8000-000000000003", "amount_kobo": 2000}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('an overdraft from a wallet is refused',
          case when sqlerrm like '%Not enough money%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 5: an overdraft from a pot is refused.
-- The test pot is empty. Try to take 1 kobo out of it.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: pot overdraft',
    'test-pot-overdraft',
    '[{"account_id": "d0000000-0000-4000-8000-000000000003", "amount_kobo": -1},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 1}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('an overdraft from a pot is refused',
          case when sqlerrm like '%Not enough money%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 6: an entry using an account from another household is refused.
-- Household A tries to send money into a pot that belongs to household B.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: other household',
    'test-other-household',
    '[{"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": -100},
      {"account_id": "d0000000-0000-4000-8000-000000000009", "amount_kobo": 100}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('an entry using an account from another household is refused',
          case when sqlerrm like '%different household%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 7: the bank_source account is allowed to go negative.
-- The bank is already at minus 1,000. Take another 500 from it and check
-- that this is accepted and the bank is now at minus 1,500.
do $$
declare
  v_balance bigint;
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: bank goes further negative',
    'test-bank-negative',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -500},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 500}]'::jsonb
  );

  select balance_kobo into v_balance
  from public.account_balances
  where account_id = 'd0000000-0000-4000-8000-000000000001';

  insert into test_results (test_name, result, detail)
  values ('the bank_source account is allowed to go negative',
          case when v_balance = -1500 then 'pass' else 'FAIL' end,
          format('bank balance: %s (expected -1500)', v_balance));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('the bank_source account is allowed to go negative', 'FAIL', sqlerrm);
end $$;

-- Test 8: a zero amount is refused.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: zero amount',
    'test-zero-amount',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": 0},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 0}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a zero amount is refused',
          case when sqlerrm like '%cannot be zero%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;


-- ---------------------------------------------------------------------
-- DIRECT INSERT ATTACKS (going around post_transaction)
-- ---------------------------------------------------------------------
-- These write straight into the tables, the way someone bypassing the
-- front door would. "set constraints all immediate" tells the database
-- to run its end-of-save rules right now, so we can see them refuse.

-- Test 9: a transaction with no entries is refused.
do $$
begin
  insert into public.transactions (household_id, description, idempotency_key)
  values ('c0000000-0000-4000-8000-000000000001', 'Test: no entries', 'test-direct-no-entries');
  set constraints all immediate;
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a transaction with no entries is refused',
          case when sqlerrm like '%has 0 entries%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 10 (extra, not on the original list): a directly inserted
-- transaction with a single entry is refused. Test 3 is stopped early by
-- post_transaction's own input check, so this one proves the underlying
-- database rule also refuses a single entry.
do $$
declare
  v_transaction_id uuid;
begin
  insert into public.transactions (household_id, description, idempotency_key)
  values ('c0000000-0000-4000-8000-000000000001', 'Test: direct single entry', 'test-direct-single-entry')
  returning id into v_transaction_id;

  insert into public.entries (transaction_id, account_id, amount_kobo)
  values (v_transaction_id, 'd0000000-0000-4000-8000-000000000001', -5);

  set constraints all immediate;
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a directly inserted transaction with a single entry is refused',
          case when sqlerrm like '%has 1 entries%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 11: adding a balanced pair of entries to an OLD transaction is
-- refused. Everything in this file happens in one save, so we cannot wait
-- a day. Instead we pretend: we insert a transaction dated yesterday
-- (this is the only place allowed to set created_at by hand), then try to
-- add a +50 / -50 pair to it.
do $$
declare
  v_transaction_id uuid;
begin
  insert into public.transactions (household_id, description, idempotency_key, created_at)
  values ('c0000000-0000-4000-8000-000000000001', 'Test: old transaction', 'test-old-transaction',
          now() - interval '1 day')
  returning id into v_transaction_id;

  insert into public.entries (transaction_id, account_id, amount_kobo)
  values
    (v_transaction_id, 'd0000000-0000-4000-8000-000000000001', -50),
    (v_transaction_id, 'd0000000-0000-4000-8000-000000000002', 50);

  set constraints all immediate;
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('adding a balanced pair of entries to an OLD transaction is refused',
          case when sqlerrm like '%same save as their transaction%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;


-- ---------------------------------------------------------------------
-- APPEND-ONLY (history cannot be changed)
-- ---------------------------------------------------------------------
-- These use the entries and the transaction saved by Test 1.

-- Test 12: updating an entry is refused.
do $$
begin
  update public.entries
  set amount_kobo = amount_kobo + 1
  where account_id = 'd0000000-0000-4000-8000-000000000002';
  raise exception 'NOT REFUSED: the action was allowed (or there was no entry to change)';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('updating an entry is refused',
          case when sqlerrm like '%ledger cannot be changed: UPDATE%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 13: deleting an entry is refused.
do $$
begin
  delete from public.entries
  where account_id = 'd0000000-0000-4000-8000-000000000002';
  raise exception 'NOT REFUSED: the action was allowed (or there was no entry to delete)';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('deleting an entry is refused',
          case when sqlerrm like '%ledger cannot be changed: DELETE%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 14: deleting a transaction is refused.
do $$
begin
  delete from public.transactions
  where household_id = 'c0000000-0000-4000-8000-000000000001'
    and idempotency_key = 'test-fund';
  raise exception 'NOT REFUSED: the action was allowed (or there was no transaction to delete)';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('deleting a transaction is refused',
          case when sqlerrm like '%ledger cannot be changed: DELETE%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 15: truncating entries is refused.
-- "Truncate" means wipe the whole table in one go. It is tried inside the
-- protected block, and it is refused before anything is removed.
do $$
begin
  truncate table public.entries;
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('truncating entries is refused',
          case when sqlerrm like '%ledger cannot be changed: TRUNCATE%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;


-- ---------------------------------------------------------------------
-- ACCOUNTS
-- ---------------------------------------------------------------------

-- Test 16: changing an account's kind is refused.
-- Try to relabel the test bank (which is below zero) as a pot.
do $$
begin
  update public.accounts
  set kind = 'pot'
  where id = 'd0000000-0000-4000-8000-000000000001';
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('changing an account''s kind is refused',
          case when sqlerrm like '%household and kind cannot be changed%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 17: moving an account to another household is refused.
do $$
begin
  update public.accounts
  set household_id = 'c0000000-0000-4000-8000-000000000002'
  where id = 'd0000000-0000-4000-8000-000000000004';
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('moving an account to another household is refused',
          case when sqlerrm like '%household and kind cannot be changed%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 18: renaming an account is allowed.
do $$
declare
  v_name text;
begin
  update public.accounts
  set name = 'Renamed Spare Pot'
  where id = 'd0000000-0000-4000-8000-000000000004';

  select name into v_name
  from public.accounts
  where id = 'd0000000-0000-4000-8000-000000000004';

  insert into test_results (test_name, result, detail)
  values ('renaming an account is allowed',
          case when v_name = 'Renamed Spare Pot' then 'pass' else 'FAIL' end,
          format('name is now: %s', v_name));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('renaming an account is allowed', 'FAIL', sqlerrm);
end $$;


-- ---------------------------------------------------------------------
-- post_transaction: INPUT CHECKS AND REPLAY
-- ---------------------------------------------------------------------

-- Test 19: the same request twice returns replayed true and adds no rows.
-- Send Test 1's request again, exactly as before. Count the rows before
-- and after to prove nothing was written.
do $$
declare
  v_result jsonb;
  v_original_id uuid;
  v_transactions_before bigint;
  v_transactions_after bigint;
  v_entries_before bigint;
  v_entries_after bigint;
begin
  select id into v_original_id
  from public.transactions
  where household_id = 'c0000000-0000-4000-8000-000000000001'
    and idempotency_key = 'test-fund';

  select count(*) into v_transactions_before from public.transactions;
  select count(*) into v_entries_before from public.entries;

  v_result := public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: fund the wallet',
    'test-fund',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -1000},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 1000}]'::jsonb
  );

  select count(*) into v_transactions_after from public.transactions;
  select count(*) into v_entries_after from public.entries;

  insert into test_results (test_name, result, detail)
  values ('the same request twice returns replayed true and adds no rows',
          case when (v_result ->> 'replayed') = 'true'
                and (v_result ->> 'transaction_id') = v_original_id::text
                and v_transactions_after = v_transactions_before
                and v_entries_after = v_entries_before
               then 'pass' else 'FAIL' end,
          format('answer: %s, transactions %s -> %s, entries %s -> %s',
                 v_result, v_transactions_before, v_transactions_after,
                 v_entries_before, v_entries_after));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('the same request twice returns replayed true and adds no rows', 'FAIL', sqlerrm);
end $$;

-- Test 20: the same request with the entries in a different order is a
-- replay. Same key, same two lines, wallet line first this time.
do $$
declare
  v_result jsonb;
begin
  v_result := public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: fund the wallet',
    'test-fund',
    '[{"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 1000},
      {"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -1000}]'::jsonb
  );

  insert into test_results (test_name, result, detail)
  values ('the same request with the entries in a different order is a replay',
          case when (v_result ->> 'replayed') = 'true' then 'pass' else 'FAIL' end,
          format('answer: %s', v_result));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('the same request with the entries in a different order is a replay', 'FAIL', sqlerrm);
end $$;

-- Test 21: the same key with different amounts is refused.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: fund the wallet',
    'test-fund',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -999},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 999}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('the same key with different amounts is refused',
          case when sqlerrm like '%already used for a different transaction%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 22: a decimal amount is refused. Half a kobo does not exist.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: decimal amount',
    'test-decimal',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -100.5},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 100.5}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a decimal amount is refused',
          case when sqlerrm like '%no decimals%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 23: a text amount is refused. "100" in quotes is text, not a number.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: text amount',
    'test-text-amount',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": "-100"},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": "100"}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a text amount is refused',
          case when sqlerrm like '%cannot be text or null%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 24: a missing amount is refused.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: missing amount',
    'test-missing-amount',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001"},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 100}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a missing amount is refused',
          case when sqlerrm like '%amount_kobo is missing%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 25: a bad uuid is refused.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: bad uuid',
    'test-bad-uuid',
    '[{"account_id": "not-a-real-id", "amount_kobo": -100},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 100}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a bad uuid is refused',
          case when sqlerrm like '%is not a valid uuid%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 26: an unknown account is refused.
-- The id below is correctly shaped, but no such account exists.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: unknown account',
    'test-unknown-account',
    '[{"account_id": "eeeeeeee-0000-4000-8000-000000000000", "amount_kobo": -100},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 100}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('an unknown account is refused',
          case when sqlerrm like 'Account % does not exist%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 27: a blank description is refused. Spaces alone count as blank.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    '   ',
    'test-blank-description',
    '[{"account_id": "d0000000-0000-4000-8000-000000000001", "amount_kobo": -100},
      {"account_id": "d0000000-0000-4000-8000-000000000002", "amount_kobo": 100}]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('a blank description is refused',
          case when sqlerrm like '%description is required%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;

-- Test 28: fewer than two entries is refused. Here the list is empty.
do $$
begin
  perform public.post_transaction(
    'c0000000-0000-4000-8000-000000000001',
    'Test: empty list',
    'test-empty-list',
    '[]'::jsonb
  );
  raise exception 'NOT REFUSED: the action was allowed';
exception when others then
  insert into test_results (test_name, result, detail)
  values ('fewer than two entries is refused',
          case when sqlerrm like '%at least two entries, but 0 given%' then 'pass' else 'FAIL' end,
          sqlerrm);
end $$;


-- ---------------------------------------------------------------------
-- TOTALS
-- ---------------------------------------------------------------------

-- Test 29: after all of the above, the sum of all balances in the test
-- household equals exactly zero. Money only moved between accounts; none
-- was created or lost.
do $$
declare
  v_total numeric;
  v_accounts bigint;
begin
  select coalesce(sum(balance_kobo), 0), count(*)
    into v_total, v_accounts
  from public.account_balances
  where household_id = 'c0000000-0000-4000-8000-000000000001';

  insert into test_results (test_name, result, detail)
  values ('the sum of all balances in the test household equals exactly zero',
          case when v_total = 0 and v_accounts = 4 then 'pass' else 'FAIL' end,
          format('total of %s accounts: %s kobo (expected 4 accounts, 0 kobo)', v_accounts, v_total));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('the sum of all balances in the test household equals exactly zero', 'FAIL', sqlerrm);
end $$;

-- Test 30: no transaction in the test household has entries that fail to
-- add up to zero. A transaction with no entries at all also counts as
-- broken. Only the two good transactions (Tests 1 and 7) should exist.
do $$
declare
  v_broken bigint;
  v_total bigint;
begin
  select count(*) filter (where s.entry_total <> 0 or s.entry_count < 2), count(*)
    into v_broken, v_total
  from (
    select t.id,
           coalesce(sum(e.amount_kobo), 0) as entry_total,
           count(e.id) as entry_count
    from public.transactions t
    left join public.entries e on e.transaction_id = t.id
    where t.household_id = 'c0000000-0000-4000-8000-000000000001'
    group by t.id
  ) s;

  insert into test_results (test_name, result, detail)
  values ('no transaction in the test household has entries that fail to add up to zero',
          case when v_broken = 0 and v_total = 2 then 'pass' else 'FAIL' end,
          format('%s broken out of %s transactions (expected 0 out of 2)', v_broken, v_total));
exception when others then
  insert into test_results (test_name, result, detail)
  values ('no transaction in the test household has entries that fail to add up to zero', 'FAIL', sqlerrm);
end $$;


-- ---------------------------------------------------------------------
-- RESULTS
-- ---------------------------------------------------------------------
-- The Supabase SQL editor shows only the LAST thing a file does, so the
-- report is delivered as a deliberate error message. An error also throws
-- the whole save away, which is exactly what we want: no trace is left.
-- Read the red message as your test report, not as a crash.
do $$
declare
  v_report text;
  v_passed bigint;
  v_failed bigint;
  v_total bigint;
begin
  select count(*) filter (where result = 'pass'),
         count(*) filter (where result <> 'pass'),
         count(*)
    into v_passed, v_failed, v_total
  from test_results;

  select string_agg(format('%s. [%s] %s%s', id, result, test_name,
                           case when result = 'pass' then '' else ' -> ' || detail end),
                    E'\n' order by id)
    into v_report
  from test_results;

  raise exception E'TEST REPORT: % (% passed, % failed, % recorded, 30 expected). Nothing was saved.\n%',
    case when v_failed = 0 and v_total = 30 then 'ALL PASSED' else 'NOT ALL PASSED' end,
    v_passed, v_failed, v_total, v_report;
end $$;
