// Tests for the Slice 6 database calls: the arguments they send, and the
// checks on each answer.
//
// Run with:  npm test
//
// A stand-in rpc records each call and gives back the answer the test
// chooses. No real database is used.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInviteCall,
  getActiveInviteCall,
  getHouseholdMembersCall,
  joinHouseholdCall,
  type JoinHouseholdArgs,
  type Rpc,
  type RpcAnswer,
} from "./auth-db-core.ts";
import { INVITE_REFUSAL_CODES, JOIN_REFUSAL_CODES } from "./invite-rules.ts";

const CUSTOMER = "c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const HOUSEHOLD = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION = "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";
const INVITE = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const HEX = (c: string) => c.repeat(64);
const RAW = "SECRET-WORDING-FROM-THE-DATABASE";

type Call = { name: string; args: Record<string, unknown> };

function standInRpc(answer: RpcAnswer | (() => never)): { rpc: Rpc; calls: Call[] } {
  const calls: Call[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    if (typeof answer === "function") {
      return answer();
    }
    return answer;
  };
  return { rpc, calls };
}

const ok = (data: unknown): RpcAnswer => ({ data, error: null, status: 200 });
const raised = (message: string): RpcAnswer => ({ data: null, error: { message }, status: 400 });
const noAnswer: RpcAnswer = { data: null, error: { message: `fetch failed ${RAW}` }, status: 0 };

describe("createInviteCall", () => {
  const ARGS = { customerId: CUSTOMER, codeHash: HEX("a"), codeEncrypted: "iv.body.tag", keyVersion: 1, maxPerDay: 10 };

  it("calls create_invite with its 5 arguments in the migration's order", async () => {
    const { rpc, calls } = standInRpc(ok({ invite_id: INVITE, expires_at: "2026-11-29T13:05:00+00:00" }));
    await createInviteCall(ARGS, rpc);
    assert.equal(calls[0].name, "create_invite");
    assert.deepEqual(Object.keys(calls[0].args), ["p_customer_id", "p_code_hash", "p_code_encrypted", "p_key_version", "p_max_per_day"]);
    assert.deepEqual(Object.values(calls[0].args), [CUSTOMER, HEX("a"), "iv.body.tag", 1, 10]);
    assert.ok(!Object.keys(calls[0].args).some((name) => /household/.test(name)));
  });

  it("a good answer gives ok, the invite id and the end time", async () => {
    const { rpc } = standInRpc(ok({ invite_id: INVITE, expires_at: "2026-11-29T13:05:00+00:00" }));
    assert.deepEqual(await createInviteCall(ARGS, rpc), { ok: true, inviteId: INVITE, expiresAt: "2026-11-29T13:05:00+00:00" });
  });

  for (const code of INVITE_REFUSAL_CODES) {
    it(`a ${code} refusal gives only its code, with none of the database's words`, async () => {
      const { rpc } = standInRpc(raised(`${code}: ${RAW}`));
      const result = await createInviteCall(ARGS, rpc);
      assert.deepEqual(result, { ok: false, code });
      assert.ok(!JSON.stringify(result).includes(RAW));
    });
  }

  for (const [label, answer] of [
    ["no answer (status 0)", noAnswer],
    ["an unlisted code", raised(`under_18: ${RAW}`)],
    ["no code", raised(RAW)],
    ["an answer with no id", ok({ expires_at: "2026-11-29T13:05:00+00:00" })],
    ["an answer whose time is not a time", ok({ invite_id: INVITE, expires_at: "soon" })],
  ] as const) {
    it(`${label} gives unknown`, async () => {
      const result = await createInviteCall(ARGS, standInRpc(answer).rpc);
      assert.deepEqual(result, { ok: false, code: "unknown" });
      assert.ok(!JSON.stringify(result).includes(RAW));
    });
  }

  it("a call that throws gives unknown", async () => {
    const { rpc } = standInRpc(() => {
      throw new Error(RAW);
    });
    assert.deepEqual(await createInviteCall(ARGS, rpc), { ok: false, code: "unknown" });
  });
});

describe("getActiveInviteCall", () => {
  it("calls get_active_invite with only the customer id", async () => {
    const { rpc, calls } = standInRpc(ok(null));
    await getActiveInviteCall(CUSTOMER, rpc);
    assert.deepEqual(calls, [{ name: "get_active_invite", args: { p_customer_id: CUSTOMER } }]);
  });

  it("an invite gives the locked copy, key version and end time", async () => {
    const { rpc } = standInRpc(ok({ code_encrypted: "iv.body.tag", key_version: 1, expires_at: "2026-11-29T13:05:00+00:00" }));
    assert.deepEqual(await getActiveInviteCall(CUSTOMER, rpc), {
      kind: "active",
      codeEncrypted: "iv.body.tag",
      keyVersion: 1,
      expiresAt: "2026-11-29T13:05:00+00:00",
    });
  });

  it("nothing (null) gives none: a partner, or an owner with no unused code", async () => {
    assert.deepEqual(await getActiveInviteCall(CUSTOMER, standInRpc(ok(null)).rpc), { kind: "none" });
  });

  for (const [label, answer] of [
    ["a failure", noAnswer],
    ["an error", raised(RAW)],
    ["an empty locked copy", ok({ code_encrypted: "", key_version: 1, expires_at: "2026-11-29T13:05:00Z" })],
    ["a key version of 0", ok({ code_encrypted: "a.b.c", key_version: 0, expires_at: "2026-11-29T13:05:00Z" })],
    ["a time that is not a time", ok({ code_encrypted: "a.b.c", key_version: 1, expires_at: "later" })],
    ["a list", ok([])],
  ] as const) {
    it(`${label} gives failed`, async () => {
      assert.deepEqual(await getActiveInviteCall(CUSTOMER, standInRpc(answer).rpc), { kind: "failed" });
    });
  }

  it("a customer id that is not a UUID gives failed with no call", async () => {
    const { rpc, calls } = standInRpc(ok(null));
    assert.deepEqual(await getActiveInviteCall("x", rpc), { kind: "failed" });
    assert.equal(calls.length, 0);
  });
});

describe("joinHouseholdCall", () => {
  const ARGS: JoinHouseholdArgs = {
    fullName: "Tunde Okafor",
    phone: "00012345678",
    dateOfBirth: "1988-03-02",
    role: "husband",
    nin: "00011112222",
    bvn: "00033334444",
    testTermsAccepted: true,
    inviteHash: HEX("1"),
    codeHash: HEX("2"),
    codeEncrypted: "iv.body.tag",
    keyVersion: 1,
    visitorHash: HEX("3"),
    maxSignUpsPerVisitor: 3,
    maxCustomersPerDay: 50,
    maxCustomersTotal: 300,
    maxWrongInvitesPer15Minutes: 5,
    maxWrongInvitesPer24Hours: 20,
    tokenHash: HEX("4"),
    idleDays: 30,
    absoluteDays: 180,
  };

  it("calls join_household with its 20 arguments in the migration's order, with their types", async () => {
    const { rpc, calls } = standInRpc(ok({ status: "invite_not_valid" }));
    await joinHouseholdCall(ARGS, rpc);
    assert.equal(calls[0].name, "join_household");
    const expected: Array<[string, string]> = [
      ["p_full_name", "string"],
      ["p_phone", "string"],
      ["p_date_of_birth", "string"],
      ["p_role", "string"],
      ["p_nin", "string"],
      ["p_bvn", "string"],
      ["p_test_terms_accepted", "boolean"],
      ["p_invite_hash", "string"],
      ["p_code_hash", "string"],
      ["p_code_encrypted", "string"],
      ["p_key_version", "number"],
      ["p_visitor_hash", "string"],
      ["p_max_signups_per_visitor", "number"],
      ["p_max_customers_per_day", "number"],
      ["p_max_customers_total", "number"],
      ["p_max_wrong_invites_per_15_minutes", "number"],
      ["p_max_wrong_invites_per_24_hours", "number"],
      ["p_token_hash", "string"],
      ["p_idle_days", "number"],
      ["p_absolute_days", "number"],
    ];
    assert.equal(expected.length, 20);
    assert.deepEqual(Object.keys(calls[0].args), expected.map(([name]) => name));
    for (const [name, type] of expected) {
      assert.equal(typeof calls[0].args[name], type, name);
    }
    assert.deepEqual(Object.values(calls[0].args), Object.values(ARGS));
  });

  it("joined gives the three ids", async () => {
    const { rpc } = standInRpc(ok({ status: "joined", customer_id: CUSTOMER, household_id: HOUSEHOLD, session_id: SESSION }));
    assert.deepEqual(await joinHouseholdCall(ARGS, rpc), { status: "joined", customerId: CUSTOMER, householdId: HOUSEHOLD, sessionId: SESSION });
  });

  for (const status of ["invite_not_valid", "too_many_attempts"] as const) {
    it(`${status} is a normal result, not an error`, async () => {
      assert.deepEqual(await joinHouseholdCall(ARGS, standInRpc(ok({ status })).rpc), { status });
    });
  }

  for (const code of JOIN_REFUSAL_CODES) {
    it(`a raised ${code} gives only its code, with none of the database's words`, async () => {
      const result = await joinHouseholdCall(ARGS, standInRpc(raised(`${code}: ${RAW}`)).rpc);
      assert.deepEqual(result, { status: "refused", code });
      assert.ok(!JSON.stringify(result).includes(RAW));
    });
  }

  for (const [label, answer] of [
    ["no answer", noAnswer],
    ["an unlisted code", raised(`not_owner: ${RAW}`)],
    ["joined without ids", ok({ status: "joined" })],
    ["an unknown status", ok({ status: "welcome" })],
    ["nothing", ok(null)],
  ] as const) {
    it(`${label} gives refused unknown`, async () => {
      const result = await joinHouseholdCall(ARGS, standInRpc(answer).rpc);
      assert.deepEqual(result, { status: "refused", code: "unknown" });
      assert.ok(!JSON.stringify(result).includes(RAW));
    });
  }

  it("never tries again after a failure", async () => {
    const { rpc, calls } = standInRpc(noAnswer);
    await joinHouseholdCall(ARGS, rpc);
    assert.equal(calls.length, 1);
  });
});

describe("getHouseholdMembersCall", () => {
  const TWO = [
    { full_name: "Ada Okafor", member_role: "owner", is_you: false },
    { full_name: "Tunde Okafor", member_role: "partner", is_you: true },
  ];

  it("calls get_household_members with only the customer id", async () => {
    const { rpc, calls } = standInRpc(ok(TWO));
    await getHouseholdMembersCall(CUSTOMER, rpc);
    assert.deepEqual(calls, [{ name: "get_household_members", args: { p_customer_id: CUSTOMER } }]);
  });

  it("gives names, roles and is_you only", async () => {
    assert.deepEqual(await getHouseholdMembersCall(CUSTOMER, standInRpc(ok(TWO)).rpc), [
      { fullName: "Ada Okafor", memberRole: "owner", isYou: false },
      { fullName: "Tunde Okafor", memberRole: "partner", isYou: true },
    ]);
  });

  it("drops anything extra", async () => {
    const data = TWO.map((m) => ({ ...m, customer_id: CUSTOMER, colour: "green" }));
    const result = await getHouseholdMembersCall(CUSTOMER, standInRpc(ok(data)).rpc);
    assert.ok(!JSON.stringify(result).includes(CUSTOMER));
    assert.ok(!JSON.stringify(result).includes("green"));
  });

  for (const [label, data] of [
    ["a phone number in the answer", [{ ...TWO[0], phone: "00012345678" }, TWO[1]]],
    ["a NIN in a name", [{ ...TWO[0], full_name: "Ada 00011112222" }, TWO[1]]],
    ["three members", [...TWO, { full_name: "Kemi", member_role: "partner", is_you: false }]],
    ["no member", []],
    ["nobody marked as you", [{ ...TWO[0] }, { ...TWO[1], is_you: false }]],
    ["two owners", [TWO[0], { ...TWO[1], member_role: "owner" }]],
    ["a bad role", [{ ...TWO[0], member_role: "guest" }, TWO[1]]],
    ["is_you as text", [{ ...TWO[0], is_you: "true" }, TWO[1]]],
    ["not a list", { members: TWO }],
  ] as const) {
    it(`${label} is refused as malformed`, async () => {
      assert.equal(await getHouseholdMembersCall(CUSTOMER, standInRpc(ok(data)).rpc), null);
    });
  }

  it("a failure gives null, and a bad id makes no call", async () => {
    assert.equal(await getHouseholdMembersCall(CUSTOMER, standInRpc(noAnswer).rpc), null);
    const { rpc, calls } = standInRpc(ok(TWO));
    assert.equal(await getHouseholdMembersCall("x", rpc), null);
    assert.equal(calls.length, 0);
  });
});
