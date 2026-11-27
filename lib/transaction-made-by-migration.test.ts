// Source checks on the Slice 6 "made by" migration and its grants, in the
// same style as lib/household-invites-migration.test.ts.
//
// Run with:  npm test
//
// This does not run the SQL. It reads the files and fails if a rule the
// plan depends on has gone missing, or if the old post_transaction, which
// the live app still calls, would be changed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const SQL = read("20261127140000_transaction_made_by.sql");
const GRANTS = read("20261127140100_transaction_made_by_grants.sql");
const OLD = read("20261112120100_post_transaction.sql");
const STATEMENTS = read("20261126090000_account_statements.sql");
const stripComments = (text: string) => text.replace(/--.*$/gm, "");
const CODE = stripComments(SQL);
const GRANTS_CODE = stripComments(GRANTS);

function bodyOf(name: string): string {
  const start = CODE.indexOf(`create function public.${name}(`);
  const end = CODE.indexOf("$$;", start);
  assert.ok(start !== -1 && end > start, `${name} not found`);
  return CODE.slice(start, end);
}

describe("the made-by migration", () => {
  it("adds a nullable created_by on transactions, referencing customers, with no default at first", () => {
    assert.match(CODE, /alter table public\.transactions\s+add column created_by uuid references public\.customers \(id\);/);
    assert.ok(!/add column created_by[^;]*not null/i.test(CODE));
    assert.ok(!/add column created_by[^;]*default/i.test(CODE));
  });

  it("sets the default in its own statement, from the save-only value", () => {
    assert.match(
      CODE,
      /alter table public\.transactions\s+alter column created_by set default nullif\(current_setting\('familyfi\.created_by', true\), ''\)::uuid;/,
    );
  });

  it("checks created_by is a member of the transaction's household as each row is added", () => {
    const body = bodyOf("transaction_creator_is_member");
    assert.match(body, /m\.household_id = new\.household_id/);
    assert.match(body, /m\.customer_id = new\.created_by/);
    assert.match(CODE, /create trigger transactions_creator_is_member\s+before insert on public\.transactions/);
  });

  it("adds post_transaction_by with the old arguments plus the person", () => {
    assert.match(
      CODE,
      /create function public\.post_transaction_by\(\s+p_household_id uuid,\s+p_description text,\s+p_idempotency_key text,\s+p_entries jsonb,\s+p_created_by uuid\s+\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/,
    );
  });

  it("post_transaction_by refuses a non-member before posting, then calls post_transaction unchanged", () => {
    const body = bodyOf("post_transaction_by");
    assert.match(body, /raise exception 'bad_request: /);
    assert.match(body, /raise exception 'not_member: /);
    const memberAt = body.indexOf("not_member");
    const callAt = body.indexOf("public.post_transaction(p_household_id, p_description, p_idempotency_key, p_entries)");
    assert.ok(memberAt !== -1 && callAt > memberAt);
  });

  it("post_transaction_by sets the value for this save only, and clears it on success and on failure", () => {
    const body = bodyOf("post_transaction_by");
    assert.match(body, /set_config\('familyfi\.created_by', p_created_by::text, true\)/);
    assert.equal(body.match(/set_config\('familyfi\.created_by', '', true\)/g)?.length, 2);
    assert.match(body, /when others then\s+perform set_config\('familyfi\.created_by', '', true\);\s+raise;/);
  });

  it("a replay by a different person is refused like a different transaction", () => {
    const body = bodyOf("post_transaction_by");
    assert.match(body, /if v_saved_by is distinct from p_created_by then/);
    assert.match(body, /was already used for a different transaction/);
    assert.match(body, /using errcode = 'unique_violation'/);
  });

  it("never drops, replaces or alters the old post_transaction", () => {
    assert.ok(!/drop function/i.test(CODE));
    assert.ok(!/create or replace function public\.post_transaction\(/i.test(CODE));
    assert.ok(!/create function public\.post_transaction\(/i.test(CODE));
    assert.ok(!/alter function public\.post_transaction\b/i.test(CODE));
    assert.ok(!/post_transaction\(uuid, text, text, jsonb\)/.test(CODE + GRANTS_CODE));
  });

  it("does not touch the append-only rule", () => {
    assert.ok(!/ledger_is_append_only|transactions_no_update_or_delete/.test(CODE));
    assert.ok(!/drop trigger|alter trigger|disable trigger/i.test(CODE));
    assert.ok(!/update public\.transactions/i.test(CODE));
  });

  it("the view keeps every existing column, in order, and adds made_by_name at the end", () => {
    const oldColumns = [
      "e.id as entry_id",
      "e.seq",
      "e.account_id",
      "a.household_id",
      "e.transaction_id",
      "t.description",
      "t.created_at",
      "e.amount_kobo",
      ")::bigint as balance_after_kobo",
    ];
    const view = CODE.slice(CODE.indexOf("create or replace view public.account_statements"));
    let at = 0;
    for (const column of oldColumns) {
      assert.ok(STATEMENTS.includes(column), `${column} not in the original view`);
      const found = view.indexOf(column, at);
      assert.ok(found >= at, `${column} missing or out of order`);
      at = found;
    }
    assert.ok(view.indexOf("as made_by_name") > at, "made_by_name must come after every old column");
    assert.match(view, /with \(security_invoker = true\)/);
  });

  it("the name comes only from a member of the same household, and not for the bank side", () => {
    const view = CODE.slice(CODE.indexOf("create or replace view public.account_statements"));
    assert.match(view, /when a\.kind = 'bank_source' then null/);
    assert.match(view, /m\.household_id = t\.household_id/);
    assert.match(view, /where c\.id = t\.created_by/);
    assert.match(view, /left join lateral/);
  });

  it("has no forbidden words and no em dashes", () => {
    for (const text of [SQL, GRANTS]) {
      assert.ok(!/fake/i.test(text), "forbidden word 1");
      assert.ok(!/demo/i.test(text), "forbidden word 2");
      assert.ok(!text.includes("—"), "em dash");
    }
  });
});

describe("the made-by grants", () => {
  it("post_transaction_by goes to service_role only, with its exact types", () => {
    const flat = GRANTS_CODE.replace(/\s+/g, " ");
    assert.ok(flat.includes("revoke execute on function public.post_transaction_by(uuid, text, text, jsonb, uuid) from public, anon, authenticated;"));
    assert.ok(flat.includes("grant execute on function public.post_transaction_by(uuid, text, text, jsonb, uuid) to service_role;"));
    assert.ok(!/to (anon|authenticated|public)/.test(GRANTS_CODE));
  });

  it("post_transaction's grants are left exactly as they were", () => {
    assert.ok(!/post_transaction\(/.test(GRANTS_CODE.replace(/post_transaction_by\(/g, "")));
    // The original grants are still in the original file, unchanged.
    assert.match(OLD, /revoke execute on function public\.post_transaction\(uuid, text, text, jsonb\)\s+from public, anon, authenticated;/);
    assert.match(OLD, /grant execute on function public\.post_transaction\(uuid, text, text, jsonb\)\s+to service_role;/);
  });

  it("the trigger function is taken from public, anon and authenticated", () => {
    assert.match(GRANTS_CODE, /revoke execute on function public\.transaction_creator_is_member\(\)\s+from public, anon, authenticated;/);
  });
});
