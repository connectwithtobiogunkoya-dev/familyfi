// Source checks on the Slice 6 invite functions and their grants, in the
// same style as lib/household-invites-migration.test.ts.
//
// Run with:  npm test
//
// This does not run the SQL. It reads the files and fails if a rule the
// plan depends on has gone missing, or if the grants no longer match the
// functions' exact argument types.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const SQL = read("20261127130000_invite_functions.sql");
const GRANTS = read("20261127130100_invite_functions_grants.sql");
const stripComments = (text: string) => text.replace(/--.*$/gm, "");
const CODE = stripComments(SQL);
const GRANTS_CODE = stripComments(GRANTS);

const FUNCTIONS = ["create_invite", "get_active_invite", "join_household", "get_household_members"];

// The arguments of one function, as [name, type] pairs, in order.
function argumentsOf(name: string): Array<[string, string]> {
  const match = CODE.match(new RegExp(`create function public\\.${name}\\(([^)]*)\\)\\s*returns jsonb`));
  assert.ok(match, `${name} not found`);
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [argName, type] = part.split(/\s+/);
      return [argName, type];
    });
}

// The body of one function, from its "create function" to its "$$;".
function bodyOf(name: string): string {
  const start = CODE.indexOf(`create function public.${name}(`);
  const end = CODE.indexOf("$$;", start);
  assert.ok(start !== -1 && end > start, `${name} body not found`);
  return CODE.slice(start, end);
}

describe("the invite functions migration", () => {
  it("creates exactly the four planned functions, and changes no existing one", () => {
    const created = [...CODE.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    assert.deepEqual(created, FUNCTIONS);
    assert.ok(!/create or replace|alter function|drop function/i.test(CODE));
  });

  for (const name of FUNCTIONS) {
    it(`${name}: security definer, search_path pinned, takes no household id`, () => {
      const body = bodyOf(name);
      assert.match(body, /security definer\s+set search_path = ''/);
      assert.ok(!argumentsOf(name).some(([argName]) => /household/.test(argName)), "a household argument");
    });
  }

  it("create_invite has the planned arguments", () => {
    assert.deepEqual(argumentsOf("create_invite"), [
      ["p_customer_id", "uuid"],
      ["p_code_hash", "text"],
      ["p_code_encrypted", "text"],
      ["p_key_version", "integer"],
      ["p_max_per_day", "integer"],
    ]);
  });

  it("create_invite refuses with each planned code, voids before it inserts, and locks the household", () => {
    const body = bodyOf("create_invite");
    for (const code of ["bad_request", "not_owner", "household_full", "limit_invites", "code_taken"]) {
      assert.match(body, new RegExp(`raise exception '${code}: `), code);
    }
    const voidAt = body.indexOf("set voided_at = now()");
    const insertAt = body.indexOf("insert into public.household_invites");
    assert.ok(voidAt !== -1 && insertAt > voidAt, "the old invite must be voided before the new one is added");
    assert.match(body, /pg_advisory_xact_lock\(42072, hashtext\(v_household_id::text\)\)/);
  });

  it("join_household has its 20 arguments in the planned order", () => {
    assert.deepEqual(argumentsOf("join_household"), [
      ["p_full_name", "text"],
      ["p_phone", "text"],
      ["p_date_of_birth", "date"],
      ["p_role", "text"],
      ["p_nin", "text"],
      ["p_bvn", "text"],
      ["p_test_terms_accepted", "boolean"],
      ["p_invite_hash", "text"],
      ["p_code_hash", "text"],
      ["p_code_encrypted", "text"],
      ["p_key_version", "integer"],
      ["p_visitor_hash", "text"],
      ["p_max_signups_per_visitor", "integer"],
      ["p_max_customers_per_day", "integer"],
      ["p_max_customers_total", "integer"],
      ["p_max_wrong_invites_per_15_minutes", "integer"],
      ["p_max_wrong_invites_per_24_hours", "integer"],
      ["p_token_hash", "text"],
      ["p_idle_days", "integer"],
      ["p_absolute_days", "integer"],
    ]);
  });

  it("join_household gives back invite_not_valid and too_many_attempts, never raises them", () => {
    const body = bodyOf("join_household");
    assert.match(body, /return jsonb_build_object\('status', 'too_many_attempts'\);/);
    assert.equal(body.match(/return jsonb_build_object\('status', 'invite_not_valid'\);/g)?.length, 3);
    assert.ok(!/raise exception '(invite_not_valid|too_many_attempts|household_full)/.test(body));
  });

  it("join_household records invite_failed every time it says invite_not_valid", () => {
    const body = bodyOf("join_household");
    assert.equal(body.match(/values \('invite_failed', p_visitor_hash\);/g)?.length, 3);
  });

  it("join_household takes the locks in the planned order, with the shared numbers", () => {
    const body = bodyOf("join_household");
    const visitor = body.indexOf("pg_advisory_xact_lock(42071, hashtext(p_visitor_hash))");
    const household = body.indexOf("pg_advisory_xact_lock(42072, hashtext(v_household_id::text))");
    const forUpdate = body.indexOf("for update");
    const signUp = body.indexOf("pg_advisory_xact_lock(4207100)");
    assert.ok(visitor !== -1 && household > visitor && forUpdate > household && signUp > forUpdate);
  });

  it("join_household checks the wrong-invite limit before it looks at the invite", () => {
    const body = bodyOf("join_household");
    assert.ok(body.indexOf("a.kind = 'invite_failed'") < body.indexOf("where i.code_hash = p_invite_hash"));
  });

  it("join_household raises the same detail refusals as create_household, and has no role rule", () => {
    const body = bodyOf("join_household");
    for (const code of ["bad_request", "bad_details", "not_verified", "under_18", "code_taken", "limit_visitor", "limit_daily", "limit_total"]) {
      assert.match(body, new RegExp(`raise exception '${code}: `), code);
    }
    assert.match(body, /p_role not in \('husband', 'wife'\)/);
    // Nothing compares the partner's role with anyone else's.
    assert.ok(!/c\.role\s*(=|<>)|role\s*=\s*v_|owner.{0,40}role/i.test(body.replace(/member_role/g, "")));
  });

  it("join_household makes the membership a partner, creates no accounts, and marks the invite used", () => {
    const body = bodyOf("join_household");
    assert.match(body, /values \(v_household_id, v_customer_id, 'partner'\);/);
    assert.ok(!/insert into public\.(accounts|account_numbers|households)/.test(body));
    assert.match(body, /set used_at = now\(\),\s+used_by = v_customer_id,\s+code_encrypted = null,\s+key_version = null/);
  });

  it("get_active_invite gives a partner nothing, and voids an invite past its time", () => {
    const body = bodyOf("get_active_invite");
    assert.match(body, /v_member_role <> 'owner' then\s+return null;/);
    assert.match(body, /if v_expires_at <= now\(\) then\s+update public\.household_invites i\s+set voided_at = now\(\),\s+code_encrypted = null,\s+key_version = null/);
  });

  it("get_household_members gives names and roles only", () => {
    const body = bodyOf("get_household_members");
    assert.match(body, /'full_name', c\.full_name/);
    assert.match(body, /'member_role', m\.member_role/);
    assert.match(body, /'is_you', m\.customer_id = p_customer_id/);
    assert.ok(!/phone|nin|bvn|date_of_birth|access_code|code_hash|code_encrypted|'customer_id'|'household_id'/.test(body));
  });

  it("has no forbidden words and no em dashes", () => {
    for (const text of [SQL, GRANTS]) {
      assert.ok(!/fake/i.test(text), "forbidden word 1");
      assert.ok(!/demo/i.test(text), "forbidden word 2");
      assert.ok(!text.includes("—"), "em dash");
    }
  });
});

describe("the invite functions grants", () => {
  for (const name of FUNCTIONS) {
    it(`${name}: revoked from public, anon and authenticated, granted to service_role, with its exact types`, () => {
      const types = argumentsOf(name).map(([, type]) => type).join(", ");
      const signature = `public.${name}(${types})`;
      const flat = GRANTS_CODE.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");
      assert.ok(flat.includes(`revoke execute on function ${signature} from public, anon, authenticated;`), `revoke for ${signature}`);
      assert.ok(flat.includes(`grant execute on function ${signature} to service_role;`), `grant for ${signature}`);
    });
  }

  it("grants nothing else", () => {
    const grants = [...GRANTS_CODE.matchAll(/grant execute on function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    assert.deepEqual(grants, FUNCTIONS);
    assert.ok(!/to (anon|authenticated|public)/.test(GRANTS_CODE));
  });
});

describe("the invites migration's comment fix", () => {
  it("no longer claims service_role cannot run the trigger functions", () => {
    const tables = read("20261127120000_household_invites.sql");
    assert.ok(!tables.includes("not even service_role"));
    assert.match(tables, /service_role may still hold it through Supabase's own defaults/);
  });
});
