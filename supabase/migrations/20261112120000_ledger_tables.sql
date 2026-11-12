-- FamilyFi: ledger tables
--
-- This file creates the tables that record all money in FamilyFi.
-- The ideas behind it:
--   * Money is counted in whole kobo (100 kobo = 1 naira), never decimals.
--   * A balance is never saved anywhere. It is always worked out by
--     adding up the entries for an account.
--   * Every movement of money is "double-entry": what leaves one account
--     arrives in another, so the entries of one transaction add up to zero.
--   * History is never edited or erased. Mistakes are fixed by adding a
--     new transaction that reverses the old one.


-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------

-- households: one row per family using FamilyFi.
-- Every account and every transaction belongs to exactly one household.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- accounts: the places money can sit inside a household.
--   'wallet'      = the shared family wallet.
--   'pot'         = a labelled pot such as rent, school fees or groceries.
--   'bank_source' = stands for the outside world (the bank that money
--                   comes in from). It is allowed to go below zero,
--                   because that is how new money enters the system.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  name text not null,
  kind text not null,
  created_at timestamptz not null default now(),

  -- Rule: the kind must be one of the three allowed words, nothing else.
  constraint accounts_kind_allowed
    check (kind in ('wallet', 'pot', 'bank_source')),

  -- Rule: a household cannot have two accounts with the same name.
  constraint accounts_name_unique_per_household
    unique (household_id, name)
);

-- Rule: a household can have only one wallet.
create unique index accounts_one_wallet_per_household
  on public.accounts (household_id)
  where kind = 'wallet';

-- Rule: a household can have only one bank_source.
create unique index accounts_one_bank_source_per_household
  on public.accounts (household_id)
  where kind = 'bank_source';

-- transactions: one row per movement of money, for example
-- "Move 5,000 naira from wallet to rent pot". The row itself holds no
-- amounts; the amounts live in the entries table below.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  description text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),

  -- Rule: the same idempotency_key cannot be used twice in one household.
  -- An idempotency key is a unique label the app attaches to each request.
  -- If the same request is sent twice by accident (a double tap, a retry
  -- on a bad connection), the second one is refused, so the money does
  -- not move twice.
  constraint transactions_idempotency_key_unique_per_household
    unique (household_id, idempotency_key)
);

-- entries: the individual lines of a transaction. Each line says
-- "this account went up or down by this many kobo".
--   Positive amount = money INTO the account.
--   Negative amount = money OUT of the account.
-- A transfer of 500 kobo from wallet to a pot is two entries:
--   wallet -500, pot +500.
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  account_id uuid not null references public.accounts (id),
  -- bigint is a whole number, so fractions of a kobo are impossible.
  amount_kobo bigint not null,
  created_at timestamptz not null default now(),

  -- Rule: an entry of zero is meaningless, so it is not allowed.
  constraint entries_amount_never_zero
    check (amount_kobo <> 0)
);

-- These two indexes are lookup aids (like the index at the back of a
-- book). They make "all entries of this transaction" and "all entries of
-- this account" fast to find. They do not change any rule.
create index entries_transaction_id_idx on public.entries (transaction_id);
create index entries_account_id_idx on public.entries (account_id);


-- ---------------------------------------------------------------------
-- VIEW: account_balances
-- ---------------------------------------------------------------------

-- account_balances: a live calculation, not a stored table. Each time it
-- is read, it adds up every entry of every account and shows the total.
-- An account with no entries shows 0. Nothing here is saved, so a balance
-- can never drift out of step with the entries.
-- security_invoker = true means the view follows the same access rules as
-- the tables underneath it: whoever reads the view can only see what they
-- would be allowed to see in the tables directly.
create view public.account_balances
  with (security_invoker = true)
as
select
  a.id as account_id,
  a.household_id,
  a.name,
  a.kind,
  coalesce(sum(e.amount_kobo), 0)::bigint as balance_kobo
from public.accounts a
left join public.entries e on e.account_id = a.id
group by a.id, a.household_id, a.name, a.kind;


-- ---------------------------------------------------------------------
-- RULES CHECKED AT THE MOMENT A TRANSACTION IS SAVED
-- ---------------------------------------------------------------------
-- A transaction and its entries are written one row at a time, so halfway
-- through, the rows do not yet add up. These rules are therefore
-- "deferred": the database waits until all rows have been written and
-- checks them at the very end, just before saving for good. If any rule
-- fails, everything written in that save is thrown away, as if it never
-- happened.
--
-- The checking functions are marked "security definer". This means they
-- always look at ALL the rows when checking, even if the person saving
-- is only allowed to see some of them. Without it, a rule could be fooled
-- by rows it was not allowed to see.

-- Rules 6a and 6b: a transaction must have at least two entries, and its
-- entries must add up to exactly zero. Money cannot appear from nowhere
-- or vanish: whatever leaves one account must arrive in another.
create function public.check_transaction_is_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_entry_count bigint;
  v_total numeric;
begin
  if tg_table_name = 'transactions' then
    v_transaction_id := new.id;
  else
    v_transaction_id := new.transaction_id;
  end if;

  select count(*), coalesce(sum(e.amount_kobo), 0)
    into v_entry_count, v_total
  from public.entries e
  where e.transaction_id = v_transaction_id;

  if v_entry_count < 2 then
    raise exception
      'Transaction % has % entries. A transaction needs at least two.',
      v_transaction_id, v_entry_count
      using errcode = 'check_violation';
  end if;

  if v_total <> 0 then
    raise exception
      'Transaction % does not balance. Its entries add up to % kobo, but they must add up to exactly zero.',
      v_transaction_id, v_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

-- Runs the check above when a transaction row is added. This catches a
-- transaction saved with no entries at all.
create constraint trigger transactions_10_must_balance
  after insert on public.transactions
  deferrable initially deferred
  for each row
  execute function public.check_transaction_is_balanced();

-- Runs the same check when an entry is added. This catches a transaction
-- with only one entry, or with entries that do not add up to zero.
create constraint trigger entries_20_transaction_must_balance
  after insert on public.entries
  deferrable initially deferred
  for each row
  execute function public.check_transaction_is_balanced();

-- Rule 6c: every entry's account must belong to the same household as
-- the transaction. One family's transaction can never touch another
-- family's account.
create function public.check_entry_same_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction_household uuid;
  v_account_household uuid;
begin
  select t.household_id into v_transaction_household
  from public.transactions t
  where t.id = new.transaction_id;

  select a.household_id into v_account_household
  from public.accounts a
  where a.id = new.account_id;

  if v_transaction_household is distinct from v_account_household then
    raise exception
      'Entry % uses account %, which belongs to a different household than transaction %.',
      new.id, new.account_id, new.transaction_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger entries_10_same_household
  after insert on public.entries
  deferrable initially deferred
  for each row
  execute function public.check_entry_same_household();

-- Rule 6d: after saving, no wallet or pot may have a balance below zero.
-- You cannot spend money that is not there. A bank_source account is
-- exempt, because it stands for the outside bank.
--
-- About the lock: imagine two people in the same family both moving the
-- last 1,000 naira out of the wallet at the same instant. Each one,
-- looking on their own, sees 1,000 naira and thinks the move is fine. If
-- both went through, the wallet would end at minus 1,000.
-- To stop this, the check first "locks" each wallet and pot it is about
-- to check. A lock is like taking the only key to a room: the second
-- person has to wait outside until the first has finished and saved.
-- When the second person finally gets in, they see the wallet is already
-- empty, and their move is refused.
-- The accounts are always locked in the same order (by id), which makes
-- it less likely that two saves end up each waiting for the other.
create function public.check_no_overdraft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_account_name text;
  v_balance numeric;
begin
  -- Step 1: lock the wallet and pot accounts this transaction touches.
  perform 1
  from public.accounts a
  where a.kind in ('wallet', 'pot')
    and a.id in (
      select e.account_id
      from public.entries e
      where e.transaction_id = new.transaction_id
    )
  order by a.id
  for no key update of a;

  -- Step 2: add up each of those accounts and look for one below zero.
  select a.id, a.name, sum(e.amount_kobo)
    into v_account_id, v_account_name, v_balance
  from public.accounts a
  join public.entries e on e.account_id = a.id
  where a.kind in ('wallet', 'pot')
    and a.id in (
      select e2.account_id
      from public.entries e2
      where e2.transaction_id = new.transaction_id
    )
  group by a.id, a.name
  having sum(e.amount_kobo) < 0
  limit 1;

  if found then
    raise exception
      'Not enough money. Account "%" (%) would end at % kobo, and a wallet or pot cannot go below zero.',
      v_account_name, v_account_id, v_balance
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger entries_30_no_overdraft
  after insert on public.entries
  deferrable initially deferred
  for each row
  execute function public.check_no_overdraft();


-- ---------------------------------------------------------------------
-- HISTORY CANNOT BE CHANGED
-- ---------------------------------------------------------------------

-- Rule 7: transactions and entries can only be added. They can never be
-- edited, deleted or wiped. This is like writing in a bound paper ledger
-- in ink: you cannot rub a line out, you add a new line that reverses it.
-- Corrections are made with a new reversing transaction.
create function public.ledger_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'The ledger cannot be changed: % on "%" is not allowed. To correct a mistake, add a new reversing transaction.',
    tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- Blocks editing or deleting a single transaction row.
create trigger transactions_no_update_or_delete
  before update or delete on public.transactions
  for each row
  execute function public.ledger_is_append_only();

-- Blocks wiping the whole transactions table in one go.
create trigger transactions_no_truncate
  before truncate on public.transactions
  for each statement
  execute function public.ledger_is_append_only();

-- Blocks editing or deleting a single entry row.
create trigger entries_no_update_or_delete
  before update or delete on public.entries
  for each row
  execute function public.ledger_is_append_only();

-- Blocks wiping the whole entries table in one go.
create trigger entries_no_truncate
  before truncate on public.entries
  for each statement
  execute function public.ledger_is_append_only();

-- Rule: entries can only be added in the same save as their transaction.
-- Without this, someone could come back later and add a balanced pair of
-- new entries (for example +500 and -500) to an old transaction. Every
-- other rule would pass, but history would have been changed. This rule
-- closes that gap: once a transaction has been saved, no more lines can
-- ever be added to it.
-- How it works: the database stamps every transaction with the start time
-- of the save that created it. Each new entry is only accepted if its
-- transaction carries the start time of the save happening right now.
create function public.entry_must_join_current_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.transactions t
    where t.id = new.transaction_id
      and t.created_at = now()
  ) then
    raise exception
      'Entry % cannot be added to transaction %: entries can only be added in the same save as their transaction.',
      new.id, new.transaction_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Runs the check above before each entry is written.
create trigger entries_05_same_save
  before insert on public.entries
  for each row
  execute function public.entry_must_join_current_save();

-- Rule: an account's household and kind can never change after it is
-- created. Its name may still change (for example renaming the
-- "groceries" pot to "food").
-- Without this, an account could be moved to another family, or a
-- bank_source that is below zero could be relabelled as a pot. Either
-- would break the rules above after the fact, without any new entry
-- being written. If a different kind of account is needed, create a new
-- account instead.
create function public.accounts_identity_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.kind is distinct from old.kind then
    raise exception
      'An account''s household and kind cannot be changed. Create a new account instead.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Runs the check above before any change to an account row.
create trigger accounts_identity_fixed
  before update on public.accounts
  for each row
  execute function public.accounts_identity_is_fixed();


-- ---------------------------------------------------------------------
-- ACCESS: LOCKED BY DEFAULT
-- ---------------------------------------------------------------------

-- Rule 8: Row Level Security is switched on for all four tables, and no
-- access policies are created. Think of it as fitting a lock to every
-- door without handing out any keys yet: nothing can be read or written
-- through the public API until a later step adds policies on purpose.
-- The account_balances view follows the same locks.
alter table public.households enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.entries enable row level security;
