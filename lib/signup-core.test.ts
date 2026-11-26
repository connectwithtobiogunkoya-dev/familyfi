// Tests for signing up.
//
// Run with:  npm test
//
// Stand-ins replace the settings, secrets and database. The keys here are
// made fresh for each run and are never real keys.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { accessCodeFingerprint } from "./access-code.ts";
import { decryptAccessCode } from "./access-code-crypto.ts";
import type { CreateHouseholdArgs, CreateHouseholdResult } from "./auth-db-core.ts";
import { signUpRefusalSentence } from "./auth-limits.ts";
import type { IdentityInput } from "./identity.ts";
import { sessionTokenFingerprint } from "./session-token.ts";
import { runSignUp, type SignUpContext, type SignUpDeps } from "./signup-core.ts";
import { visitorFingerprint } from "./visitor.ts";

const LOCKING_KEY = randomBytes(32);
const VISITOR_KEY = randomBytes(32).toString("hex");
const ACCESS_CODE = "K7QM-3XPD-9RTA-W2FH";
const SESSION_TOKEN = "tTok_8Hn3k2LqP9sVwXyZ0aBcDeFgHiJkLmNoPqRsTuV";

const FORM: IdentityInput = {
  fullName: "Ada Okafor",
  phone: "000 1234 5678",
  dateOfBirth: "1990-05-17",
  role: "wife",
  nin: "00011112222",
  bvn: "00033334444",
  householdName: "",
  testTermsAccepted: true,
};

const CONTEXT: SignUpContext = { address: "203.0.113.7", isDevelopment: false, now: new Date("2026-11-26T11:00:00Z") };

const OK: CreateHouseholdResult = {
  ok: true,
  customerId: "c1111111-1111-4111-8111-111111111111",
  householdId: "a2222222-2222-4222-8222-222222222222",
  sessionId: "e3333333-3333-4333-8333-333333333333",
};

function standIn(changes: Partial<SignUpDeps> = {}, answer: CreateHouseholdResult | (() => never) = OK) {
  const calls: CreateHouseholdArgs[] = [];
  let generated = 0;
  const deps: SignUpDeps = {
    signupsEnabled: () => true,
    accessCodeKeys: () => new Map([[1, LOCKING_KEY]]),
    visitorKey: () => VISITOR_KEY,
    createHousehold: async (args) => {
      calls.push(args);
      if (typeof answer === "function") {
        return answer();
      }
      return answer;
    },
    generateAccessCode: () => {
      generated += 1;
      return ACCESS_CODE;
    },
    generateSessionToken: () => {
      generated += 1;
      return SESSION_TOKEN;
    },
    ...changes,
  };
  return { deps, calls, generatedCount: () => generated };
}

describe("runSignUp: the early exits make no database call", () => {
  it("sign-up switched off: paused, nothing made, no call", async () => {
    const s = standIn({ signupsEnabled: () => false });
    assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "paused" });
    assert.equal(s.calls.length, 0);
    assert.equal(s.generatedCount(), 0);
  });

  it("the locking key missing: fails closed with the unknown sentence, no call", async () => {
    const s = standIn({ accessCodeKeys: () => null });
    assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "refused", code: "unknown", message: signUpRefusalSentence("unknown") });
    assert.equal(s.calls.length, 0);
  });

  it("a key map without version 1: fails closed, no call", async () => {
    const s = standIn({ accessCodeKeys: () => new Map([[2, LOCKING_KEY]]) });
    assert.equal((await runSignUp(FORM, CONTEXT, s.deps)).status, "refused");
    assert.equal(s.calls.length, 0);
  });

  it("the visitor key missing: fails closed, no call", async () => {
    const s = standIn({ visitorKey: () => null });
    assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "refused", code: "unknown", message: signUpRefusalSentence("unknown") });
    assert.equal(s.calls.length, 0);
  });

  it("field problems: per-field sentences, nothing made, no call", async () => {
    const s = standIn();
    const result = await runSignUp({ ...FORM, phone: "08012345678", fullName: "A" }, CONTEXT, s.deps);
    assert.equal(result.status, "field_errors");
    if (result.status === "field_errors") {
      assert.equal(result.fields.phone?.problem, "not_test_number");
      assert.equal(result.fields.fullName?.problem, "too_short");
    }
    assert.equal(s.calls.length, 0);
    assert.equal(s.generatedCount(), 0);
  });

  it("a NIN ending in 99: not_verified with its sentence, nothing made, no call", async () => {
    const s = standIn();
    assert.deepEqual(await runSignUp({ ...FORM, nin: "00011112299" }, CONTEXT, s.deps), {
      status: "not_verified",
      message: "We could not verify these details. This is a simulated check.",
    });
    assert.equal(s.calls.length, 0);
    assert.equal(s.generatedCount(), 0);
  });

  it("the switch is checked before the secrets", async () => {
    const s = standIn({ signupsEnabled: () => false, accessCodeKeys: () => null });
    assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "paused" });
  });

  it("the secrets are checked before the details", async () => {
    const s = standIn({ visitorKey: () => null });
    assert.equal((await runSignUp({ ...FORM, phone: "x" }, CONTEXT, s.deps)).status, "refused");
  });
});

describe("runSignUp: a good sign-up", () => {
  it("returns only ok and the session token", async () => {
    const s = standIn();
    assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "ok", sessionToken: SESSION_TOKEN });
    assert.equal(s.calls.length, 1);
  });

  it("sends only fingerprints and the locked copy: never the plain code or plain token", async () => {
    const s = standIn();
    await runSignUp(FORM, CONTEXT, s.deps);
    const sent = JSON.stringify(s.calls[0]);
    assert.ok(!sent.includes(ACCESS_CODE));
    assert.ok(!sent.includes(ACCESS_CODE.replace(/-/g, "")));
    assert.ok(!sent.includes(SESSION_TOKEN));
    for (const value of Object.values(s.calls[0])) {
      assert.notEqual(value, ACCESS_CODE);
      assert.notEqual(value, SESSION_TOKEN);
    }
  });

  it("the code's fingerprint is sent, and unlocking the locked copy with the test key gives back the code", async () => {
    const s = standIn();
    await runSignUp(FORM, CONTEXT, s.deps);
    const args = s.calls[0];
    assert.equal(args.codeHash, accessCodeFingerprint(ACCESS_CODE));
    assert.equal(args.keyVersion, 1);
    assert.equal(decryptAccessCode(args.codeEncrypted, LOCKING_KEY), ACCESS_CODE);
  });

  it("the token's fingerprint sent equals the fingerprint of the token returned", async () => {
    const s = standIn();
    const result = await runSignUp(FORM, CONTEXT, s.deps);
    assert.ok(result.status === "ok");
    assert.equal(s.calls[0].tokenHash, sessionTokenFingerprint(result.sessionToken));
  });

  it("sends the tidied details, the visitor's fingerprint and the approved limits", async () => {
    const s = standIn();
    await runSignUp(FORM, CONTEXT, s.deps);
    const args = s.calls[0];
    assert.equal(args.phone, "00012345678");
    assert.equal(args.testTermsAccepted, true);
    assert.equal(args.visitorHash, visitorFingerprint("203.0.113.7", VISITOR_KEY));
    assert.equal(args.maxSignUpsPerVisitor, 3);
    assert.equal(args.maxCustomersPerDay, 50);
    assert.equal(args.maxCustomersTotal, 300);
    assert.equal(args.idleDays, 30);
    assert.equal(args.absoluteDays, 180);
  });

  it("in development, the unknown bucket gets the higher sign-up limit", async () => {
    const s = standIn();
    await runSignUp(FORM, { ...CONTEXT, address: "unknown", isDevelopment: true }, s.deps);
    assert.equal(s.calls[0].maxSignUpsPerVisitor, 1000);
  });

  it("the result contains none of the typed secrets and no access code", async () => {
    const s = standIn();
    const text = JSON.stringify(await runSignUp(FORM, CONTEXT, s.deps));
    for (const value of ["00011112222", "00033334444", "00012345678", "000 1234 5678", ACCESS_CODE, ACCESS_CODE.replace(/-/g, "")]) {
      assert.ok(!text.includes(value), value);
    }
  });
});

describe("runSignUp: refusals and failures", () => {
  for (const code of ["limit_visitor", "limit_daily", "limit_total", "under_18", "bad_details", "code_taken"] as const) {
    it(`${code} gives its sentence, and nothing else`, async () => {
      const s = standIn({}, { ok: false, code });
      assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "refused", code, message: signUpRefusalSentence(code) });
    });
  }

  it("a network failure (unknown) gives the unknown sentence", async () => {
    const s = standIn({}, { ok: false, code: "unknown" });
    assert.deepEqual(await runSignUp(FORM, CONTEXT, s.deps), { status: "refused", code: "unknown", message: signUpRefusalSentence("unknown") });
  });

  it("a database call that throws gives the unknown sentence", async () => {
    const s = standIn({}, () => {
      throw new Error("down");
    });
    assert.equal((await runSignUp(FORM, CONTEXT, s.deps)).status, "refused");
  });

  it("no second call is made after a failure", async () => {
    const s = standIn({}, { ok: false, code: "unknown" });
    await runSignUp(FORM, CONTEXT, s.deps);
    assert.equal(s.calls.length, 1);
  });

  it("a refusal never contains the typed secrets or the access code", async () => {
    const s = standIn({}, { ok: false, code: "limit_total" });
    const text = JSON.stringify(await runSignUp(FORM, CONTEXT, s.deps));
    for (const value of ["00011112222", "00033334444", "00012345678", ACCESS_CODE, SESSION_TOKEN]) {
      assert.ok(!text.includes(value), value);
    }
  });
});
