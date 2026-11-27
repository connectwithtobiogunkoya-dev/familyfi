-- FamilyFi: who made each transaction (Slice 6, migration 4)
--
-- With two people sharing a household's money, each transaction records
-- which member made it. This file adds:
--   * transactions.created_by   the member who made it (null for older rows)
--   * a rule that created_by, when set, is a member of that household
--   * post_transaction_by       posts a transaction exactly as
--                               post_transaction does, and records who
--                               made it
--   * account_statements gains one column at the end, made_by_name
--
-- It needs the ledger migrations, the statements migration and every
-- Slice 5 migration to have been run first.
--
-- It runs in an ordinary Postgres: no extensions are used. Who may call
-- post_transaction_by is set in 20261127140100_transaction_made_by_grants.sql
-- (Supabase only).
--
-- WHICH FUNCTION THE APP USES
--   * Until the step 8 app code is pushed, the live app keeps calling
--     post_transaction(uuid, text, text, jsonb). This file does not change
--     it, its arguments, its behaviour or its grants in any way. Its
--     transactions simply have created_by null.
--   * From step 8 on, the app calls post_transaction_by instead.
--   * post_transaction is kept only for the old code during the switch. A
--     later migration, after the step 8 push, will retire it.
--
-- WHY THE NEW FUNCTION CALLS THE OLD ONE INSTEAD OF COPYING IT
--   Every posting rule lives in post_transaction (and the ledger's own
--   triggers), so post_transaction_by calls it rather than repeating it.
--   But transactions can never be updated (rule 7, the append-only rule),
--   so created_by cannot be filled in after post_transaction has saved the
--   row: it must be there as the row is inserted. So:
--     1. post_transaction_by checks that the person is a member of the
--        household.
--     2. It sets a value that lasts only for this save,
--        familyfi.created_by, to that person.
--     3. It calls post_transaction, unchanged. The new column's default
--        reads familyfi.created_by, so the row post_transaction inserts
--        records the person.
--     4. It clears the value again, whether posting worked or failed.
--   A rule on the table checks the person once more as the row is added,
--   so even a wrong value could never record someone outside the
--   household.


-- ---------------------------------------------------------------------
-- 1. THE NEW COLUMN
-- ---------------------------------------------------------------------

-- created_by: the member who made the transaction. Null for every
-- transaction saved before this file, and for any saved through the old
-- post_transaction until it is retired.
--
-- Adding a column with no default rewrites no rows: Postgres only records
-- the new column, and every existing row reads it as null. No row is
-- updated, so the append-only rule (transactions_no_update_or_delete,
-- which refuses every update and delete) does not fire, and it still
-- refuses every update and every delete afterwards, of any column,
-- created_by included: once a transaction is saved, its created_by can
-- never be set, changed or cleared.
alter table public.transactions
  add column created_by uuid references public.customers (id);

-- The default is set in a separate statement, after the column exists, so
-- that no existing row is given a value: a default added this way applies
-- only to rows inserted from now on. It reads familyfi.created_by, which
-- only post_transaction_by sets, for the length of one save. Anywhere
-- else it is not set, and the default gives null.
alter table public.transactions
  alter column created_by set default nullif(current_setting('familyfi.created_by', true), '')::uuid;

-- Rule: when created_by is set, that person must be a member of the
-- transaction's own household. Checked as each row is added (and rows are
-- never changed afterwards).
create function public.transaction_creator_is_member()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is not null and not exists (
    select 1
    from public.household_members m
    where m.household_id = new.household_id
      and m.customer_id = new.created_by
  ) then
    raise exception
      'not_member: The person making this transaction is not a member of its household.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger transactions_creator_is_member
  before insert on public.transactions
  for each row
  execute function public.transaction_creator_is_member();


-- ---------------------------------------------------------------------
-- 2. post_transaction_by
-- ---------------------------------------------------------------------

-- post_transaction_by: posts a transaction exactly as post_transaction
-- does, and records which member made it.
--
-- What you give it: everything post_transaction takes, in the same order,
-- then the person:
--   p_household_id, p_description, p_idempotency_key, p_entries
--   p_created_by     the member making it, from their session on the server
--
-- What it gives back: exactly what post_transaction gives back:
--   {"transaction_id": "<id>", "replayed": false}  saved now
--   {"transaction_id": "<id>", "replayed": true}   saved earlier, by the
--                                                  same person, with the
--                                                  same entries
--
-- Refusals of its own (at the start of the message, before the colon):
--   bad_request  p_created_by is missing
--   not_member   p_created_by is not a member of p_household_id
-- and, for a replay by a different person, the same refusal
-- post_transaction gives for the same key with different entries
-- (unique_violation, "Idempotency key ... was already used for a different
-- transaction ..."). Every other refusal is post_transaction's own,
-- unchanged.
--
-- Replays:
--   * Same key, same entries, same person: post_transaction finds the
--     earlier transaction and writes nothing; this function checks the
--     earlier row was made by the same person and gives back the same
--     answer. No second row is ever made.
--   * Same key, different entries: post_transaction refuses it, exactly as
--     today.
--   * Same key, same entries, a different person (or an earlier row with
--     no person, saved through the old post_transaction): refused here as
--     a different transaction.
--   As today, the description is not compared.
create function public.post_transaction_by(
  p_household_id uuid,
  p_description text,
  p_idempotency_key text,
  p_entries jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_transaction_id uuid;
  v_saved_by uuid;
begin
  if p_created_by is null then
    raise exception 'bad_request: The person making the transaction is required.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The person must be a member of this household.
  if not exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.customer_id = p_created_by
  ) then
    raise exception 'not_member: The person making this transaction is not a member of its household.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Post, with the person recorded by the column's default. The value is
  -- set only for this save ("true" below), and cleared again whatever
  -- happens, so nothing after this call can pick it up by accident.
  begin
    perform set_config('familyfi.created_by', p_created_by::text, true);
    v_result := public.post_transaction(p_household_id, p_description, p_idempotency_key, p_entries);
    perform set_config('familyfi.created_by', '', true);
  exception
    when others then
      perform set_config('familyfi.created_by', '', true);
      raise;
  end;

  -- A replay must be by the same person as the first time.
  if (v_result ->> 'replayed')::boolean then
    v_transaction_id := (v_result ->> 'transaction_id')::uuid;

    select t.created_by into v_saved_by
    from public.transactions t
    where t.id = v_transaction_id;

    if v_saved_by is distinct from p_created_by then
      raise exception
        'Idempotency key "%" was already used for a different transaction (%) in this household. Use a new key for a new transaction.',
        p_idempotency_key, v_transaction_id
        using errcode = 'unique_violation';
    end if;
  end if;

  return v_result;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. account_statements: who made each line
-- ---------------------------------------------------------------------

-- The view gains one column, made_by_name, at the end: the full name of
-- the member who made the line's transaction. Every existing column stays
-- exactly as it was, with the same name, type and order, so anything that
-- reads the view today (the app selects description, created_at,
-- amount_kobo and balance_after_kobo by name) keeps working. "create or
-- replace view" allows exactly this, adding columns at the end, and keeps
-- the view's existing grants.
--
-- made_by_name is null:
--   * for a transaction with no created_by (every older one)
--   * for the household's bank account's lines (the bank side of adding
--     money), where "made by" does not apply to that account's statement
--
-- It can never show anyone outside the household: the name is joined only
-- when that person is a member of the same household as the transaction
-- (and the account, which the ledger already requires to match). The view
-- stays security_invoker, so it follows the same access rules as the
-- tables underneath: anon and authenticated have no access to customers or
-- household_members at all, so for them the view gives nothing.
create or replace view public.account_statements
  with (security_invoker = true)
as
select
  e.id as entry_id,
  e.seq,
  e.account_id,
  a.household_id,
  e.transaction_id,
  t.description,
  t.created_at,
  e.amount_kobo,
  sum(e.amount_kobo) over (
    partition by e.account_id
    order by e.seq
    rows between unbounded preceding and current row
  )::bigint as balance_after_kobo,
  case
    when a.kind = 'bank_source' then null
    else maker.full_name
  end as made_by_name
from public.entries e
join public.accounts a on a.id = e.account_id
join public.transactions t on t.id = e.transaction_id
left join lateral (
  select c.full_name
  from public.customers c
  join public.household_members m
    on m.customer_id = c.id
   and m.household_id = t.household_id
  where c.id = t.created_by
) maker on true;
