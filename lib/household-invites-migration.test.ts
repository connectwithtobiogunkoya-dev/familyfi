// Source checks on the Slice 6 invites migration, in the same style as the
// check on the ledger migration in lib/errors.test.ts.
//
// Run with:  npm test
//
// This does not run the SQL. It reads the file and fails if one of the
// rules the plan depends on has gone missing or been reworded away.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SQL = readFileSync(new URL("../supabase/migrations/20261127120000_household_invites.sql", import.meta.url), "utf8");

// The SQL with its comments taken out, so a rule written only in a
// comment does not count.
const CODE = SQL.replace(/--.*$/gm, "");

describe("the household invites migration", () => {
  it("creates household_invites with every planned column", () => {
    assert.match(CODE, /create table public\.household_invites \(/);
    for (const column of [
      "id uuid primary key",
      "household_id uuid not null references public.households (id)",
      "created_by uuid not null references public.customers (id)",
      "code_hash text not null",
      "code_encrypted text,",
      "key_version integer,",
      "created_at timestamptz not null default now()",
      "expires_at timestamptz not null default (now() + interval '48 hours')",
      "used_at timestamptz,",
      "used_by uuid references public.customers (id)",
      "voided_at timestamptz",
    ]) {
      assert.ok(CODE.includes(column), column);
    }
  });

  it("has the rules on the row", () => {
    for (const rule of [
      "unique (code_hash)",
      "check (expires_at = created_at + interval '48 hours')",
      "check ((code_encrypted is null) = (key_version is null))",
      "check (used_at is null or voided_at is null)",
      "check ((used_at is null and voided_at is null) or code_encrypted is null)",
      "check ((used_at is null) = (used_by is null))",
    ]) {
      assert.ok(CODE.includes(rule), rule);
    }
  });

  it("allows one active invite per household, and says why expiry is not in the index", () => {
    assert.match(
      CODE,
      /create unique index household_invites_one_active_per_household\s+on public\.household_invites \(household_id\)\s+where used_at is null and voided_at is null;/,
    );
    assert.match(SQL, /now\(\) is not\s+-- allowed in an index/);
    assert.match(SQL, /must\s+-- therefore void the household's older unused invite/);
  });

  it("allows at most one partner per household, and keeps the one-owner index", () => {
    assert.match(
      CODE,
      /create unique index household_members_one_partner_per_household\s+on public\.household_members \(household_id\)\s+where member_role = 'partner';/,
    );
    assert.ok(!/drop index[^;]*one_owner/i.test(CODE));
  });

  it("has no rule about Husband or Wife", () => {
    assert.ok(!/husband|wife/i.test(CODE));
  });

  it("replaces the auth_attempts kind rule with one that allows invite_failed", () => {
    assert.match(
      CODE,
      /alter table public\.auth_attempts\s+drop constraint auth_attempts_kind_allowed,\s+add constraint auth_attempts_kind_allowed\s+check \(kind in \('sign_up', 'sign_in_failed', 'invite_failed'\)\);/,
    );
  });

  it("guards the rows: no delete, no truncate, limited updates, owner-only inserts", () => {
    assert.match(CODE, /create trigger household_invites_no_delete\s+before delete on public\.household_invites/);
    assert.match(CODE, /create trigger household_invites_no_truncate\s+before truncate on public\.household_invites/);
    assert.match(CODE, /create trigger household_invites_changes_limited\s+before update on public\.household_invites/);
    assert.match(CODE, /create trigger household_invites_creator_is_owner\s+before insert on public\.household_invites/);
  });

  it("turns Row Level Security on with no policies", () => {
    assert.match(CODE, /alter table public\.household_invites enable row level security;/);
    assert.ok(!/create policy/i.test(CODE));
  });

  it("takes everything from public, anon and authenticated, and gives service_role no delete", () => {
    assert.match(CODE, /revoke all on table public\.household_invites from public, anon, authenticated;/);
    assert.match(CODE, /grant select, insert, update on table public\.household_invites to service_role;/);
    assert.ok(!/grant[^;]*delete[^;]*household_invites/i.test(CODE));
  });

  it("creates no function the app calls (those come in the next file)", () => {
    const functions = [...CODE.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    assert.deepEqual(functions.sort(), ["household_invite_changes_are_limited", "household_invite_creator_is_owner"]);
    assert.ok(!/security definer/i.test(CODE));
  });

  it("has no forbidden words and no em dashes", () => {
    assert.ok(!/fake/i.test(SQL), "forbidden word 1");
    assert.ok(!/demo/i.test(SQL), "forbidden word 2");
    assert.ok(!SQL.includes("—"), "em dash");
  });
});
