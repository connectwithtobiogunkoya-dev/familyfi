// Tests for the thin database calls.
//
// Run with:  npm test
//
// A stand-in rpc records each call's function name and arguments, and
// gives back whatever answer the test chooses. No real database is used.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createHouseholdCall,
  endSessionRowCall,
  getAccessCodeMaterialCall,
  getSessionRowCall,
  signInWithCodeCall,
  type CreateHouseholdArgs,
  type Rpc,
  type RpcAnswer,
  type SignInArgs,
} from "./auth-db-core.ts";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const CUSTOMER = "c1111111-1111-4111-8111-111111111111";
const HOUSEHOLD = "a2222222-2222-4222-8222-222222222222";
const SESSION = "e3333333-3333-4333-8333-333333333333";

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

const HOUSEHOLD_ARGS: CreateHouseholdArgs = {
  fullName: "Ada Okafor",
  phone: "00012345678",
  dateOfBirth: "1990-05-17",
  role: "wife",
  nin: "00011112222",
  bvn: "00033334444",
  householdName: "",
  testTermsAccepted: true,
  codeHash: HEX_A,
  codeEncrypted: "locked.copy.text",
  keyVersion: 1,
  visitorHash: HEX_B,
  maxSignUpsPerVisitor: 3,
  maxCustomersPerDay: 50,
  maxCustomersTotal: 300,
  tokenHash: HEX_C,
  idleDays: 30,
  absoluteDays: 180,
};

const SIGN_IN_ARGS: SignInArgs = {
  codeHash: HEX_A,
  tokenHash: HEX_C,
  visitorHash: HEX_B,
  maxWrongPer15Minutes: 5,
  maxWrongPer24Hours: 20,
  idleDays: 30,
  absoluteDays: 180,
};

describe("createHouseholdCall: the 18 arguments, in order and with their types", () => {
  it("calls create_household with exactly the migration's 18 arguments, in order", async () => {
    const { rpc, calls } = standInRpc({ data: { customer_id: CUSTOMER, household_id: HOUSEHOLD, session_id: SESSION }, error: null, status: 200 });
    await createHouseholdCall(HOUSEHOLD_ARGS, rpc);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "create_household");
    const expected: Array<[name: string, type: string]> = [
      ["p_full_name", "string"],
      ["p_phone", "string"],
      ["p_date_of_birth", "string"],
      ["p_role", "string"],
      ["p_nin", "string"],
      ["p_bvn", "string"],
      ["p_household_name", "string"],
      ["p_test_terms_accepted", "boolean"],
      ["p_code_hash", "string"],
      ["p_code_encrypted", "string"],
      ["p_key_version", "number"],
      ["p_visitor_hash", "string"],
      ["p_max_signups_per_visitor", "number"],
      ["p_max_customers_per_day", "number"],
      ["p_max_customers_total", "number"],
      ["p_token_hash", "string"],
      ["p_idle_days", "number"],
      ["p_absolute_days", "number"],
    ];
    assert.equal(expected.length, 18);
    assert.deepEqual(Object.keys(calls[0].args), expected.map(([name]) => name));
    for (const [name, type] of expected) {
      assert.equal(typeof calls[0].args[name], type, name);
    }
  });

  it("passes each value through unchanged", async () => {
    const { rpc, calls } = standInRpc({ data: { customer_id: CUSTOMER, household_id: HOUSEHOLD, session_id: SESSION }, error: null, status: 200 });
    await createHouseholdCall(HOUSEHOLD_ARGS, rpc);
    assert.deepEqual(Object.values(calls[0].args), Object.values(HOUSEHOLD_ARGS));
  });

  it("a good answer gives ok with the three ids", async () => {
    const { rpc } = standInRpc({ data: { customer_id: CUSTOMER, household_id: HOUSEHOLD, session_id: SESSION }, error: null, status: 200 });
    assert.deepEqual(await createHouseholdCall(HOUSEHOLD_ARGS, rpc), { ok: true, customerId: CUSTOMER, householdId: HOUSEHOLD, sessionId: SESSION });
  });

  it("a refusal gives only its code", async () => {
    const { rpc } = standInRpc({ data: null, error: { message: "under_18: The person must be 18 or over." }, status: 400 });
    assert.deepEqual(await createHouseholdCall(HOUSEHOLD_ARGS, rpc), { ok: false, code: "under_18" });
  });

  const unknowns: Array<[label: string, answer: RpcAnswer | (() => never)]> = [
    ["a network failure (status 0)", { data: null, error: { message: "TypeError: fetch failed" }, status: 0 }],
    ["a call that throws", () => {
      throw new Error("network down");
    }],
    ["an error with no code", { data: null, error: { message: "something broke" }, status: 500 }],
    ["an answer with no data", { data: null, error: null, status: 200 }],
    ["an answer with a missing id", { data: { customer_id: CUSTOMER, household_id: HOUSEHOLD }, error: null, status: 200 }],
    ["an answer with an id that is not a UUID", { data: { customer_id: "x", household_id: HOUSEHOLD, session_id: SESSION }, error: null, status: 200 }],
    ["an answer that is a list", { data: [CUSTOMER], error: null, status: 200 }],
  ];

  for (const [label, answer] of unknowns) {
    it(`${label} gives unknown`, async () => {
      const { rpc } = standInRpc(answer);
      assert.deepEqual(await createHouseholdCall(HOUSEHOLD_ARGS, rpc), { ok: false, code: "unknown" });
    });
  }

  it("never tries again: one call, even after a failure", async () => {
    const { rpc, calls } = standInRpc({ data: null, error: { message: "fetch failed" }, status: 0 });
    await createHouseholdCall(HOUSEHOLD_ARGS, rpc);
    assert.equal(calls.length, 1);
  });
});

describe("signInWithCodeCall", () => {
  it("calls sign_in_with_code with its 7 arguments, in order", async () => {
    const { rpc, calls } = standInRpc({ data: { status: "wrong_code" }, error: null, status: 200 });
    await signInWithCodeCall(SIGN_IN_ARGS, rpc);
    assert.equal(calls[0].name, "sign_in_with_code");
    assert.deepEqual(Object.keys(calls[0].args), [
      "p_code_hash",
      "p_token_hash",
      "p_visitor_hash",
      "p_max_wrong_per_15_minutes",
      "p_max_wrong_per_24_hours",
      "p_idle_days",
      "p_absolute_days",
    ]);
    assert.deepEqual(Object.values(calls[0].args), Object.values(SIGN_IN_ARGS));
  });

  it("signed_in gives the ids", async () => {
    const { rpc } = standInRpc({ data: { status: "signed_in", customer_id: CUSTOMER, household_id: HOUSEHOLD }, error: null, status: 200 });
    assert.deepEqual(await signInWithCodeCall(SIGN_IN_ARGS, rpc), { status: "signed_in", customerId: CUSTOMER, householdId: HOUSEHOLD });
  });

  for (const status of ["wrong_code", "too_many_attempts", "no_household"] as const) {
    it(`${status} gives ${status}`, async () => {
      const { rpc } = standInRpc({ data: { status }, error: null, status: 200 });
      assert.deepEqual(await signInWithCodeCall(SIGN_IN_ARGS, rpc), { status });
    });
  }

  const unknowns: Array<[label: string, answer: RpcAnswer]> = [
    ["signed_in without ids", { data: { status: "signed_in" }, error: null, status: 200 }],
    ["an unknown status", { data: { status: "locked" }, error: null, status: 200 }],
    ["a raised error", { data: null, error: { message: "bad_request: x" }, status: 400 }],
    ["a network failure", { data: null, error: { message: "fetch failed" }, status: 0 }],
  ];

  for (const [label, answer] of unknowns) {
    it(`${label} gives unknown`, async () => {
      const { rpc } = standInRpc(answer);
      assert.deepEqual(await signInWithCodeCall(SIGN_IN_ARGS, rpc), { status: "unknown" });
    });
  }
});

describe("getSessionRowCall", () => {
  const person = { customer_id: CUSTOMER, household_id: HOUSEHOLD, household_name: "Okafor household", full_name: "Ada Okafor", role: "wife" };

  it("sends only the fingerprint, and gives the person", async () => {
    const { rpc, calls } = standInRpc({ data: person, error: null, status: 200 });
    assert.deepEqual(await getSessionRowCall(HEX_C, rpc), {
      customerId: CUSTOMER,
      householdId: HOUSEHOLD,
      householdName: "Okafor household",
      fullName: "Ada Okafor",
      role: "wife",
    });
    assert.deepEqual(calls, [{ name: "get_session", args: { p_token_hash: HEX_C } }]);
  });

  it("no session (null) gives null", async () => {
    const { rpc } = standInRpc({ data: null, error: null, status: 200 });
    assert.equal(await getSessionRowCall(HEX_C, rpc), null);
  });

  it("a fingerprint not in the right form gives null without calling the database", async () => {
    const { rpc, calls } = standInRpc({ data: person, error: null, status: 200 });
    assert.equal(await getSessionRowCall("not-a-fingerprint", rpc), null);
    assert.equal(calls.length, 0);
  });

  for (const [label, data] of [
    ["a bad role", { ...person, role: "partner" }],
    ["a missing name", { ...person, full_name: undefined }],
    ["a bad household id", { ...person, household_id: "x" }],
  ] as const) {
    it(`an answer with ${label} gives null`, async () => {
      const { rpc } = standInRpc({ data, error: null, status: 200 });
      assert.equal(await getSessionRowCall(HEX_C, rpc), null);
    });
  }

  it("a failure gives null", async () => {
    const { rpc } = standInRpc(() => {
      throw new Error("down");
    });
    assert.equal(await getSessionRowCall(HEX_C, rpc), null);
  });
});

describe("endSessionRowCall", () => {
  it("true only when the database says it ended one", async () => {
    const { rpc, calls } = standInRpc({ data: { ended: true }, error: null, status: 200 });
    assert.equal(await endSessionRowCall(HEX_C, rpc), true);
    assert.deepEqual(calls, [{ name: "end_session", args: { p_token_hash: HEX_C } }]);
  });

  it("false when it had already ended, on a failure, or for a bad fingerprint", async () => {
    assert.equal(await endSessionRowCall(HEX_C, standInRpc({ data: { ended: false }, error: null, status: 200 }).rpc), false);
    assert.equal(await endSessionRowCall(HEX_C, standInRpc({ data: null, error: { message: "x" }, status: 0 }).rpc), false);
    const { rpc, calls } = standInRpc({ data: { ended: true }, error: null, status: 200 });
    assert.equal(await endSessionRowCall("x", rpc), false);
    assert.equal(calls.length, 0);
  });
});

describe("getAccessCodeMaterialCall", () => {
  it("gives the locked copy and key version", async () => {
    const { rpc, calls } = standInRpc({ data: { code_encrypted: "a.b.c", key_version: 1 }, error: null, status: 200 });
    assert.deepEqual(await getAccessCodeMaterialCall(CUSTOMER, rpc), { codeEncrypted: "a.b.c", keyVersion: 1 });
    assert.deepEqual(calls, [{ name: "get_access_code_material", args: { p_customer_id: CUSTOMER } }]);
  });

  for (const [label, data] of [
    ["nothing", null],
    ["an empty locked copy", { code_encrypted: "", key_version: 1 }],
    ["a key version of 0", { code_encrypted: "a.b.c", key_version: 0 }],
    ["a key version that is text", { code_encrypted: "a.b.c", key_version: "1" }],
  ] as const) {
    it(`${label} gives null`, async () => {
      const { rpc } = standInRpc({ data, error: null, status: 200 });
      assert.equal(await getAccessCodeMaterialCall(CUSTOMER, rpc), null);
    });
  }

  it("a customer id that is not a UUID gives null without calling the database", async () => {
    const { rpc, calls } = standInRpc({ data: { code_encrypted: "a.b.c", key_version: 1 }, error: null, status: 200 });
    assert.equal(await getAccessCodeMaterialCall("x", rpc), null);
    assert.equal(calls.length, 0);
  });
});
