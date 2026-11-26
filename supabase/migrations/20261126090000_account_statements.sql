-- FamilyFi: account statements
--
-- This file adds what is needed to show a statement for one account: the
-- list of entries behind its balance, in the order they happened, with
-- the balance after each one.
--
-- It does two things:
--   1. Gives every entry a sequence number (seq), so entries have a
--      reliable order.
--   2. Creates the view account_statements, a live calculation like
--      account_balances. Nothing is stored.
--
-- It needs both earlier migrations to have been run first.


-- ---------------------------------------------------------------------
-- 1. A sequence number for every entry
-- ---------------------------------------------------------------------
-- Why this is needed: a save stamps all its rows with the time the save
-- began. The seed file saved its four transactions in one go, so they all
-- carry exactly the same created_at, and the time cannot say which came
-- first. Ordering by id does not help either, because ids are random.
--
-- seq is a counter the database fills in by itself: 1, 2, 3, and so on.
-- Each new entry gets the next number when it is written, so a later
-- entry always has a higher seq. Nobody can choose or change the number:
-- "generated always" means the database refuses any attempt to set it.
--
-- Entries that already exist are numbered once, when this line runs, in
-- the order the database finds them on disk. For a table that has only
-- ever been added to, that is normally the order they were written. The
-- statement check in step 7 confirms the seed's order came out right.
--
-- Adding a column does not count as editing an entry, so the rule that
-- entries can never be updated is not affected and does not fire.
alter table public.entries
  add column seq bigint generated always as identity;

-- Rule: no two entries can ever share a sequence number.
alter table public.entries
  add constraint entries_seq_unique unique (seq);

-- A lookup aid: makes "the entries of this account, in order" fast to
-- find. It does not change any rule.
create index entries_account_id_seq_idx on public.entries (account_id, seq);


-- ---------------------------------------------------------------------
-- 2. VIEW: account_statements
-- ---------------------------------------------------------------------
-- One row per entry, with:
--   entry_id, seq          which entry, and its place in the order
--   account_id             the account the entry belongs to
--   household_id           the family that account belongs to
--   transaction_id         the transaction the entry is part of
--   description            the transaction's description
--   created_at             when the transaction was saved
--   amount_kobo            the entry: positive = in, negative = out
--   balance_after_kobo     the account's balance straight after this entry
--
-- How balance_after_kobo is worked out: for each account separately, add
-- up that entry and every earlier entry of the same account, earlier
-- meaning a lower seq. It is never worked out from created_at or id.
-- Because it adds up the account's whole history, it is right even when
-- the app only shows the newest few lines.
--
-- Nothing is stored. Like account_balances, it is calculated every time
-- it is read, so it can never drift out of step with the entries.
--
-- security_invoker = true means the view follows the same access rules as
-- the tables underneath it, exactly as account_balances does.
create view public.account_statements
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
  )::bigint as balance_after_kobo
from public.entries e
join public.accounts a on a.id = e.account_id
join public.transactions t on t.id = e.transaction_id;
