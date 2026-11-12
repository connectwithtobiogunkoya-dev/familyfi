-- FamilyFi: post_transaction
--
-- This file adds one function, post_transaction. It is the single front
-- door for moving money: the app hands it a description, a unique request
-- label and a list of entries, and it either saves the whole transaction
-- or saves nothing at all.


-- ---------------------------------------------------------------------
-- FUNCTION: post_transaction
-- ---------------------------------------------------------------------
-- IMPORTANT NOTES
--   * This function is the only supported way to write to the ledger.
--   * It must run in Postgres's default isolation mode (read committed),
--     because the overdraft lock depends on it.
--   * If Postgres reports a deadlock, the caller must retry the whole
--     call. No money is lost.
--   * It must never set created_at.
--   * Approval rules and caps are not here. They come in a later slice.
--
-- What you give it:
--   p_household_id     which family this transaction belongs to
--   p_description      a short human description, e.g. "Top up rent pot"
--   p_idempotency_key  a unique label for this request, so that sending
--                      the same request twice cannot move money twice
--   p_entries          a JSON list of lines, for example:
--                      [{"account_id": "<uuid>", "amount_kobo": -500000},
--                       {"account_id": "<uuid>", "amount_kobo":  500000}]
--
-- What it gives back:
--   {"transaction_id": "<id>", "replayed": false}  a new transaction was saved
--   {"transaction_id": "<id>", "replayed": true}   this exact request was
--                                                  already saved earlier;
--                                                  nothing new was written
create function public.post_transaction(
  p_household_id uuid,
  p_description text,
  p_idempotency_key text,
  p_entries jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position bigint;
  v_account_text text;
  v_amount_text text;
  v_amount numeric;
  v_account_ids uuid[] := '{}';
  v_amounts bigint[] := '{}';
  v_missing_account uuid;
  v_existing_id uuid;
  v_transaction_id uuid;
  v_same boolean;
begin
  -- -------------------------------------------------------------------
  -- Part 0: refuse to run in the wrong isolation mode.
  -- The overdraft lock only works in Postgres's default mode. In any
  -- other mode, two people could spend the same money, so we stop here.
  -- -------------------------------------------------------------------
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception
      'post_transaction must run in read committed mode, but this save is using "%".',
      current_setting('transaction_isolation')
      using errcode = 'invalid_transaction_state';
  end if;

  -- -------------------------------------------------------------------
  -- Part 1: check the input before touching anything.
  -- Each problem gets its own plain-English error.
  -- -------------------------------------------------------------------
  if p_household_id is null then
    raise exception 'A household is required.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'A description is required. It cannot be blank.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'An idempotency key is required. It cannot be blank.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Entries must be a JSON list, for example [{"account_id": "...", "amount_kobo": -500}, {"account_id": "...", "amount_kobo": 500}].'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_array_length(p_entries) < 2 then
    raise exception 'A transaction needs at least two entries, but % given.',
      jsonb_array_length(p_entries)
      using errcode = 'invalid_parameter_value';
  end if;

  -- Go through the entries one by one. "Entry 1" is the first in the list.
  for v_item, v_position in
    select t.item, t.position
    from jsonb_array_elements(p_entries) with ordinality as t(item, position)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Entry %: must be an object with an account_id and an amount_kobo.',
        v_position
        using errcode = 'invalid_parameter_value';
    end if;

    -- account_id: must be present, must be text, must look like a uuid.
    if not (v_item ? 'account_id') then
      raise exception 'Entry %: account_id is missing.', v_position
        using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_typeof(v_item -> 'account_id') <> 'string' then
      raise exception 'Entry %: account_id must be a uuid written as text. It cannot be empty, a number or null.',
        v_position
        using errcode = 'invalid_parameter_value';
    end if;

    v_account_text := v_item ->> 'account_id';

    if v_account_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Entry %: account_id "%" is not a valid uuid.',
        v_position, v_account_text
        using errcode = 'invalid_parameter_value';
    end if;

    -- amount_kobo: must be present and must be a JSON whole number.
    -- Decimals (500.5, 500.0), text ("500") and null are all refused,
    -- because money is whole kobo and nothing else.
    if not (v_item ? 'amount_kobo') then
      raise exception 'Entry %: amount_kobo is missing.', v_position
        using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_typeof(v_item -> 'amount_kobo') <> 'number' then
      raise exception 'Entry %: amount_kobo must be a number. It cannot be text or null.',
        v_position
        using errcode = 'invalid_parameter_value';
    end if;

    v_amount_text := v_item ->> 'amount_kobo';

    if v_amount_text !~ '^-?[0-9]+$' then
      raise exception 'Entry %: amount_kobo must be a whole number of kobo with no decimals, but got %.',
        v_position, v_amount_text
        using errcode = 'invalid_parameter_value';
    end if;

    v_amount := v_amount_text::numeric;

    if v_amount < -9223372036854775808 or v_amount > 9223372036854775807 then
      raise exception 'Entry %: amount_kobo % is too large to store.',
        v_position, v_amount_text
        using errcode = 'invalid_parameter_value';
    end if;

    if v_amount = 0 then
      raise exception 'Entry %: amount_kobo cannot be zero.', v_position
        using errcode = 'invalid_parameter_value';
    end if;

    v_account_ids := v_account_ids || v_account_text::uuid;
    v_amounts := v_amounts || v_amount::bigint;
  end loop;

  -- The household and every account must actually exist. Checking here
  -- gives a clear message instead of a technical database error.
  if not exists (
    select 1 from public.households h where h.id = p_household_id
  ) then
    raise exception 'Household % does not exist.', p_household_id
      using errcode = 'invalid_parameter_value';
  end if;

  select u.account_id into v_missing_account
  from unnest(v_account_ids) as u(account_id)
  where not exists (
    select 1 from public.accounts a where a.id = u.account_id
  )
  limit 1;

  if found then
    raise exception 'Account % does not exist.', v_missing_account
      using errcode = 'invalid_parameter_value';
  end if;

  -- -------------------------------------------------------------------
  -- Part 2: replay protection.
  -- Has this household already used this idempotency key?
  -- -------------------------------------------------------------------
  select t.id into v_existing_id
  from public.transactions t
  where t.household_id = p_household_id
    and t.idempotency_key = p_idempotency_key;

  if v_existing_id is null then
    -- Part 3a: the key is new, so save the transaction row.
    -- created_at is deliberately not mentioned: the database fills it in.
    begin
      insert into public.transactions (household_id, description, idempotency_key)
      values (p_household_id, p_description, p_idempotency_key)
      returning id into v_transaction_id;
    exception
      when unique_violation then
        -- Two calls with the same key arrived at the same instant, and
        -- the other one saved first. Treat this call as a replay of it.
        select t.id into v_existing_id
        from public.transactions t
        where t.household_id = p_household_id
          and t.idempotency_key = p_idempotency_key;

        if v_existing_id is null then
          raise;
        end if;
    end;
  end if;

  if v_existing_id is not null then
    -- The key was used before. Compare the saved entries with the ones
    -- asked for now. Order does not matter, but every (account, amount)
    -- pair must appear the same number of times on both sides.
    select not exists (
      (
        select e.account_id, e.amount_kobo
        from public.entries e
        where e.transaction_id = v_existing_id
        except all
        select u.account_id, u.amount_kobo
        from unnest(v_account_ids, v_amounts) as u(account_id, amount_kobo)
      )
      union all
      (
        select u.account_id, u.amount_kobo
        from unnest(v_account_ids, v_amounts) as u(account_id, amount_kobo)
        except all
        select e.account_id, e.amount_kobo
        from public.entries e
        where e.transaction_id = v_existing_id
      )
    ) into v_same;

    if v_same then
      -- 2a: the very same request, sent again. Write nothing and report
      -- the transaction that was saved the first time.
      return jsonb_build_object(
        'transaction_id', v_existing_id,
        'replayed', true
      );
    end if;

    -- 2b: same key, different money. This is a mistake by the caller.
    raise exception
      'Idempotency key "%" was already used for a different transaction (%) in this household. Use a new key for a new transaction.',
      p_idempotency_key, v_existing_id
      using errcode = 'unique_violation';
  end if;

  -- -------------------------------------------------------------------
  -- Part 3b: save all the entries in one go.
  -- created_at is again left to the database.
  -- -------------------------------------------------------------------
  insert into public.entries (transaction_id, account_id, amount_kobo)
  select v_transaction_id, u.account_id, u.amount_kobo
  from unnest(v_account_ids, v_amounts) as u(account_id, amount_kobo);

  -- -------------------------------------------------------------------
  -- Part 4: run the ledger rules now instead of at the very end.
  -- The balance, household and overdraft rules normally wait until the
  -- save finishes. The first line tells the database to check them right
  -- here, so any problem is reported by this function straight away and
  -- everything it wrote is thrown away. The second line puts the rules
  -- back to waiting mode for whatever runs next.
  -- -------------------------------------------------------------------
  set constraints all immediate;
  set constraints all deferred;

  -- -------------------------------------------------------------------
  -- Part 5: report the new transaction.
  -- -------------------------------------------------------------------
  return jsonb_build_object(
    'transaction_id', v_transaction_id,
    'replayed', false
  );
end;
$$;


-- ---------------------------------------------------------------------
-- WHO MAY CALL post_transaction
-- ---------------------------------------------------------------------
-- By default, Postgres lets everyone run a new function. For a function
-- that moves money, that is the wrong default, so it is taken away here.
--   public        = everyone, including roles created in the future
--   anon          = visitors who are not signed in
--   authenticated = signed-in users calling the database directly
-- After this, only service_role can run it. service_role is the key held
-- by FamilyFi's own server code and never sent to a browser or phone. So
-- a person can only move money by asking the server, which can check who
-- they are and what they are allowed to do before it calls this function.
revoke execute on function public.post_transaction(uuid, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.post_transaction(uuid, text, text, jsonb)
  to service_role;
