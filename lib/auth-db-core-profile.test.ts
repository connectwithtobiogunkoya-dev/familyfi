// Tests for getProfileCall: the argument it sends, and the checks on the
// answer.
//
// Run with:  npm test
//
// A stand-in rpc records each call and gives back the answer the test
// chooses. No real database is used.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getProfileCall, type Rpc, type RpcAnswer } from "./auth-db-core.ts";

const CUSTOMER = "c1111111-1111-4111-8111-111111111111";
// An id with letters in every group, so it holds no run of 11 digits.
const OTHER_ID = "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a";

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

function good(): Record<string, unknown> {
  return {
    full_name: "Ada Okafor",
    role: "wife",
    phone: "00012345678",
    member_role: "owner",
    household_name: "Okafor household",
    verification_status: "verified",
    verification_method: "simulated",
    verified_at: "2026-11-26T11:00:00.123456+00:00",
    nin_last3: "222",
    bvn_last3: "444",
    accounts: [
      { name: "Family Wallet", kind: "wallet", account_number: "0001234567" },
      { name: "Groceries", kind: "pot", account_number: "0001234575" },
      { name: "Rent", kind: "pot", account_number: null },
    ],
  };
}

const EXPECTED = {
  fullName: "Ada Okafor",
  role: "wife",
  phone: "00012345678",
  memberRole: "owner",
  householdName: "Okafor household",
  verificationStatus: "verified",
  verificationMethod: "simulated",
  verifiedAt: "2026-11-26T11:00:00.123456+00:00",
  ninLast3: "222",
  bvnLast3: "444",
  accounts: [
    { name: "Family Wallet", kind: "wallet", accountNumber: "0001234567" },
    { name: "Groceries", kind: "pot", accountNumber: "0001234575" },
    { name: "Rent", kind: "pot", accountNumber: null },
  ],
};

async function read(data: unknown): Promise<unknown> {
  return getProfileCall(CUSTOMER, standInRpc({ data, error: null, status: 200 }).rpc);
}

describe("getProfileCall: the call", () => {
  it("calls get_profile with only the customer id", async () => {
    const { rpc, calls } = standInRpc({ data: good(), error: null, status: 200 });
    await getProfileCall(CUSTOMER, rpc);
    assert.deepEqual(calls, [{ name: "get_profile", args: { p_customer_id: CUSTOMER } }]);
  });

  it("a customer id that is not a UUID gives null, without calling the database", async () => {
    const { rpc, calls } = standInRpc({ data: good(), error: null, status: 200 });
    assert.equal(await getProfileCall("x", rpc), null);
    assert.equal(calls.length, 0);
  });

  it("a good answer gives the checked profile", async () => {
    assert.deepEqual(await read(good()), EXPECTED);
  });

  it("no account at all is allowed (an empty list)", async () => {
    assert.deepEqual(await read({ ...good(), accounts: [] }), { ...EXPECTED, accounts: [] });
  });

  it("an extra unexpected field is dropped", async () => {
    const result = await read({ ...good(), colour: "green", customer_id: OTHER_ID });
    assert.deepEqual(result, EXPECTED);
    assert.ok(!JSON.stringify(result).includes("green"));
    assert.ok(!JSON.stringify(result).includes(OTHER_ID));
  });

  it("an extra field on an account is dropped too", async () => {
    const data = good();
    (data.accounts as Array<Record<string, unknown>>)[0].id = OTHER_ID;
    assert.deepEqual(await read(data), EXPECTED);
  });
});

describe("getProfileCall: a full NIN or BVN is refused", () => {
  for (const [label, change] of [
    ["a full NIN in nin_last3", { nin_last3: "00011112222" }],
    ["a full BVN in bvn_last3", { bvn_last3: "00033334444" }],
    ["a full NIN as an extra field", { nin: "00011112222" }],
    ["a full BVN as an extra field", { bvn: "00033334444" }],
    ["11 digits inside another field", { household_name: "Home 00011112222" }],
  ] as const) {
    it(`${label}: the whole answer is malformed`, async () => {
      assert.equal(await read({ ...good(), ...change }), null);
    });
  }

  it("an extra id holding 11 digits in a row is refused, the safe way round", async () => {
    assert.equal(await read({ ...good(), customer_id: CUSTOMER }), null);
  });

  it("11 digits inside an account is refused", async () => {
    const data = good();
    (data.accounts as Array<Record<string, unknown>>)[1].name = "00011112222";
    assert.equal(await read(data), null);
  });

  it("the phone itself (a test number) is allowed", async () => {
    assert.equal(((await read(good())) as { phone: string }).phone, "00012345678");
  });
});

describe("getProfileCall: malformed answers give null", () => {
  const changes: Array<[label: string, change: Record<string, unknown>]> = [
    ["a missing full name", { full_name: undefined }],
    ["a full name that is a number", { full_name: 7 }],
    ["a bad role", { role: "partner" }],
    ["a phone that is not a test number", { phone: "08012345678" }],
    ["a bad member role", { member_role: "guest" }],
    ["a missing household name", { household_name: null }],
    ["a missing verification status", { verification_status: undefined }],
    ["a verification method that is not text", { verification_method: true }],
    ["a verified date that is not a date", { verified_at: "yesterday" }],
    ["last 3 of the NIN with 2 digits", { nin_last3: "22" }],
    ["last 3 of the NIN with 4 digits", { nin_last3: "2222" }],
    ["last 3 of the BVN with a letter", { bvn_last3: "44a" }],
    ["last 3 as a number", { nin_last3: 222 }],
    ["accounts that are not a list", { accounts: {} }],
    ["21 accounts", { accounts: Array.from({ length: 21 }, (_, i) => ({ name: `Pot ${i}`, kind: "pot", account_number: null })) }],
    ["a bank account in the list", { accounts: [{ name: "Hearth Bank", kind: "bank_source", account_number: null }] }],
    ["an account number of 9 digits", { accounts: [{ name: "Rent", kind: "pot", account_number: "123456789" }] }],
    ["an account number that is a number", { accounts: [{ name: "Rent", kind: "pot", account_number: 1234567890 }] }],
    ["an account with no name", { accounts: [{ kind: "pot", account_number: null }] }],
    ["an account that is text", { accounts: ["Rent"] }],
  ];

  for (const [label, change] of changes) {
    it(`${label}`, async () => {
      assert.equal(await read({ ...good(), ...change }), null);
    });
  }

  it("exactly 20 accounts is allowed", async () => {
    const accounts = Array.from({ length: 20 }, (_, i) => ({ name: `Pot ${i}`, kind: "pot", account_number: null }));
    assert.equal(((await read({ ...good(), accounts })) as { accounts: unknown[] }).accounts.length, 20);
  });

  for (const [label, answer] of [
    ["no profile (null)", { data: null, error: null, status: 200 }],
    ["a list instead of an object", { data: [good()], error: null, status: 200 }],
    ["a database error", { data: null, error: { message: "bad_request: x" }, status: 400 }],
    ["a network failure", { data: null, error: { message: "fetch failed" }, status: 0 }],
  ] as const) {
    it(`${label} gives null`, async () => {
      assert.equal(await getProfileCall(CUSTOMER, standInRpc(answer as RpcAnswer).rpc), null);
    });
  }

  it("a call that throws gives null", async () => {
    const { rpc } = standInRpc(() => {
      throw new Error("down");
    });
    assert.equal(await getProfileCall(CUSTOMER, rpc), null);
  });
});
