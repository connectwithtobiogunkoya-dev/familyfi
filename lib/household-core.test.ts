// Tests for the household screen's logic: creating and reading an invite,
// and the members list. Also the source checks for the Slice 6 plumbing.
//
// Run with:  npm test
//
// Stand-ins replace the session, the switch, the secrets and the database.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ActiveInviteResult, CreateInviteArgs, CreateInviteResult, HouseholdMember } from "./auth-db-core.ts";
import { signUpRefusalSentence } from "./auth-limits.ts";
import { runCreateInvite, runReadInvite, runReadMembers, type CreateInviteDeps } from "./household-core.ts";
import { inviteCodeFingerprint, lockInviteCode, unlockInviteCode } from "./invite-code.ts";
import type { SessionPerson } from "./session-core.ts";
import { SIGNUPS_PAUSED_SENTENCE } from "./signup-form-state.ts";

const KEY = randomBytes(32);
const CODE = "4HQX-7MRT-2KPD-9WVA";

const OWNER: SessionPerson = {
  customerId: "c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b",
  householdId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  householdName: "Okafor household",
  fullName: "Ada Okafor",
  role: "wife",
};
const PARTNER: SessionPerson = { ...OWNER, customerId: "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a", fullName: "Tunde Okafor", role: "husband" };

// The database stand-in: only the owner may create; the partner is refused.
function createStandIn(answers?: CreateInviteResult[]) {
  const calls: CreateInviteArgs[] = [];
  let made = 0;
  const deps: CreateInviteDeps = {
    writesEnabled: () => true,
    getSession: async () => OWNER,
    accessCodeKeys: () => new Map([[1, KEY]]),
    createInvite: async (args) => {
      calls.push(args);
      if (answers !== undefined) {
        return answers.shift() ?? { ok: false, code: "unknown" };
      }
      return args.customerId === OWNER.customerId
        ? { ok: true, inviteId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e", expiresAt: "2026-11-29T13:05:00+00:00" }
        : { ok: false, code: "not_owner" };
    },
    generateInviteCode: () => {
      made += 1;
      return made === 1 ? CODE : "9WVA-2KPD-7MRT-4HQX";
    },
  };
  return { deps, calls, made: () => made };
}

describe("runCreateInvite", () => {
  it("write switch off: paused first, with no session asked and no call", async () => {
    const s = createStandIn();
    let asked = 0;
    const outcome = await runCreateInvite({
      ...s.deps,
      writesEnabled: () => false,
      getSession: async () => {
        asked += 1;
        return OWNER;
      },
    });
    assert.deepEqual(outcome, { status: "paused", message: SIGNUPS_PAUSED_SENTENCE });
    assert.equal(asked, 0);
    assert.equal(s.calls.length, 0);
  });

  it("no session: signed out, no database call, nothing made", async () => {
    const s = createStandIn();
    assert.deepEqual(await runCreateInvite({ ...s.deps, getSession: async () => null }), { status: "signed_out" });
    assert.equal(s.calls.length, 0);
    assert.equal(s.made(), 0);
  });

  it("a session check that fails counts as signed out", async () => {
    const s = createStandIn();
    const outcome = await runCreateInvite({
      ...s.deps,
      getSession: async () => {
        throw new Error("down");
      },
    });
    assert.deepEqual(outcome, { status: "signed_out" });
    assert.equal(s.calls.length, 0);
  });

  it("the owner: one call for the session's own person, with only a fingerprint and a locked copy", async () => {
    const s = createStandIn();
    assert.deepEqual(await runCreateInvite(s.deps), { status: "created" });
    assert.equal(s.calls.length, 1);
    const args = s.calls[0];
    assert.equal(args.customerId, OWNER.customerId);
    assert.equal(args.codeHash, inviteCodeFingerprint(CODE));
    assert.equal(unlockInviteCode(args.codeEncrypted, KEY), CODE);
    assert.equal(args.keyVersion, 1);
    assert.equal(args.maxPerDay, 10);
    assert.ok(!JSON.stringify(args).includes(CODE));
    assert.ok(!Object.keys(args).some((name) => /household/i.test(name)));
  });

  it("the result never holds the code, its fingerprint or the locked copy", async () => {
    const s = createStandIn();
    const text = JSON.stringify(await runCreateInvite(s.deps));
    assert.ok(!text.includes(CODE));
    assert.ok(!text.includes(inviteCodeFingerprint(CODE)));
    assert.ok(!text.includes(s.calls[0].codeEncrypted));
  });

  it("a partner's session gets the only-the-owner outcome from the database itself", async () => {
    const s = createStandIn();
    const outcome = await runCreateInvite({ ...s.deps, getSession: async () => PARTNER });
    assert.deepEqual(outcome, {
      status: "refused",
      code: "not_owner",
      message: "Only the person who created the household can invite a partner.",
    });
    assert.equal(s.calls[0].customerId, PARTNER.customerId);
  });

  for (const [code, sentence] of [
    ["household_full", "Your partner has joined. Your household is full."],
    ["limit_invites", "You have made too many invite codes today. Please try again tomorrow."],
    ["bad_request", signUpRefusalSentence("unknown")],
    ["unknown", signUpRefusalSentence("unknown")],
  ] as const) {
    it(`${code} gives its fixed sentence`, async () => {
      const s = createStandIn([{ ok: false, code }]);
      assert.deepEqual(await runCreateInvite(s.deps), { status: "refused", code, message: sentence });
      assert.equal(s.calls.length, 1);
    });
  }

  it("code_taken: one fresh code is tried once more", async () => {
    const s = createStandIn([{ ok: false, code: "code_taken" }, { ok: true, inviteId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e", expiresAt: "2026-11-29T13:05:00Z" }]);
    assert.deepEqual(await runCreateInvite(s.deps), { status: "created" });
    assert.equal(s.calls.length, 2);
    assert.notEqual(s.calls[0].codeHash, s.calls[1].codeHash);
  });

  it("code_taken twice: the unknown sentence, and no third try", async () => {
    const s = createStandIn([{ ok: false, code: "code_taken" }, { ok: false, code: "code_taken" }]);
    assert.equal((await runCreateInvite(s.deps)).status, "refused");
    assert.equal(s.calls.length, 2);
  });

  it("no locking key: fails closed with no call", async () => {
    const s = createStandIn();
    assert.equal((await runCreateInvite({ ...s.deps, accessCodeKeys: () => null })).status, "refused");
    assert.equal(s.calls.length, 0);
  });
});

describe("runReadInvite", () => {
  function readDeps(person: SessionPerson | null, invite: ActiveInviteResult | (() => never)) {
    const asked: string[] = [];
    return {
      asked,
      deps: {
        getSession: async () => person,
        accessCodeKeys: () => new Map([[1, KEY]]),
        getActiveInvite: async (customerId: string) => {
          asked.push(customerId);
          if (typeof invite === "function") {
            return invite();
          }
          return invite;
        },
      },
    };
  }

  const ACTIVE: ActiveInviteResult = { kind: "active", codeEncrypted: lockInviteCode(CODE, KEY), keyVersion: 1, expiresAt: "2026-11-29T23:30:00Z" };

  it("no session: signed out, no database call", async () => {
    const r = readDeps(null, ACTIVE);
    assert.deepEqual(await runReadInvite(r.deps), { status: "signed_out" });
    assert.equal(r.asked.length, 0);
  });

  it("the owner: the code unlocked on the server, formatted, with the Lagos time line, and nothing else", async () => {
    const r = readDeps(OWNER, ACTIVE);
    const outcome = await runReadInvite(r.deps);
    assert.deepEqual(outcome, { status: "active", code: CODE, stopsWorking: "Stops working: 30 November 2026, 00:30" });
    assert.deepEqual(r.asked, [OWNER.customerId]);
    const text = JSON.stringify(outcome);
    assert.ok(!text.includes((ACTIVE as { codeEncrypted: string }).codeEncrypted));
    assert.ok(!text.includes(inviteCodeFingerprint(CODE)));
  });

  it("a partner (the database gives nothing): none", async () => {
    assert.deepEqual(await runReadInvite(readDeps(PARTNER, { kind: "none" }).deps), { status: "none" });
  });

  for (const [label, invite] of [
    ["a database failure", { kind: "failed" }],
    ["a copy that will not unlock", { ...ACTIVE, codeEncrypted: lockInviteCode(CODE, randomBytes(32)) }],
    ["no key for its version", { ...ACTIVE, keyVersion: 2 }],
    ["an end time that is not a time", { ...ACTIVE, expiresAt: "soon" }],
  ] as const) {
    it(`${label}: the unknown sentence and no code`, async () => {
      const outcome = await runReadInvite(readDeps(OWNER, invite as ActiveInviteResult).deps);
      assert.deepEqual(outcome, { status: "failed", message: signUpRefusalSentence("unknown") });
      assert.ok(!JSON.stringify(outcome).includes(CODE));
    });
  }
});

describe("runReadMembers", () => {
  const MEMBERS: HouseholdMember[] = [
    { fullName: "Ada Okafor", memberRole: "owner", isYou: false },
    { fullName: "Tunde Okafor", memberRole: "partner", isYou: true },
  ];

  it("no session: signed out, no call", async () => {
    let called = false;
    const outcome = await runReadMembers({
      getSession: async () => null,
      getHouseholdMembers: async () => {
        called = true;
        return MEMBERS;
      },
    });
    assert.deepEqual(outcome, { status: "signed_out" });
    assert.equal(called, false);
  });

  it("names, roles and is_you only, asked for the session's own person", async () => {
    const asked: string[] = [];
    const outcome = await runReadMembers({
      getSession: async () => PARTNER,
      getHouseholdMembers: async (id) => {
        asked.push(id);
        return MEMBERS.map((m) => ({ ...m, phone: "00012345678" }) as HouseholdMember);
      },
    });
    assert.deepEqual(outcome, { status: "members", members: MEMBERS });
    assert.deepEqual(asked, [PARTNER.customerId]);
    assert.ok(!JSON.stringify(outcome).includes("00012345678"));
  });

  it("a failure gives the unknown sentence", async () => {
    assert.deepEqual(await runReadMembers({ getSession: async () => OWNER, getHouseholdMembers: async () => null }), {
      status: "failed",
      message: signUpRefusalSentence("unknown"),
    });
  });
});

describe("the Slice 6 plumbing source files", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  for (const path of ["./auth-db.ts", "./join.ts", "./household.ts"]) {
    it(`${path} is server-only`, () => {
      assert.match(read(path), /^import "server-only";$/m);
    });
  }

  it("lib/auth-db.ts never asks for a read-only call", () => {
    const source = read("./auth-db.ts");
    assert.ok(!/get:\s*true|head:\s*true/.test(source));
    assert.match(source, /\.rpc\(functionName, args\)/);
  });

  for (const path of [
    "./invite-code.ts",
    "./invite-rules.ts",
    "./join-core.ts",
    "./join.ts",
    "./join-form-state.ts",
    "./join-action-core.ts",
    "./household-core.ts",
    "./household.ts",
    "./lagos-time.ts",
    "./auth-db-core.ts",
    "./auth-db.ts",
    "./auth-limits.ts",
  ]) {
    it(`${path}: no console calls, no forbidden words, no em dashes`, () => {
      const source = read(path);
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }

  it("no new file takes a household id from anywhere", () => {
    for (const path of ["./join-core.ts", "./join-action-core.ts", "./household-core.ts", "./household.ts", "./join.ts"]) {
      const code = read(path).replace(/\/\/.*$/gm, "");
      assert.ok(!/householdId\s*:|household_id/.test(code), path);
    }
  });
});
