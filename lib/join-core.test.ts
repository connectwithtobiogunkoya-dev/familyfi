// Tests for joining a household: the rules (runJoin) and the Join form's
// action logic (runJoinAction).
//
// Run with:  npm test
//
// Stand-ins replace the switches, secrets and database. The keys are made
// fresh for each run and are never real keys.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { accessCodeFingerprint } from "./access-code.ts";
import { decryptAccessCode } from "./access-code-crypto.ts";
import type { JoinHouseholdArgs, JoinHouseholdResult } from "./auth-db-core.ts";
import { signInSentence, signUpRefusalSentence } from "./auth-limits.ts";
import { inviteCodeFingerprint } from "./invite-code.ts";
import { JOIN_REFUSAL_CODES, joinSentence } from "./invite-rules.ts";
import { readJoinForm, runJoinAction, type JoinActionDeps } from "./join-action-core.ts";
import { runJoin, type JoinContext, type JoinDeps, type JoinInput } from "./join-core.ts";
import { joinGeneralSentence, INITIAL_JOIN_STATE, type JoinFormState } from "./join-form-state.ts";
import { sessionTokenFingerprint } from "./session-token.ts";
import { SIGNUPS_PAUSED_SENTENCE } from "./signup-form-state.ts";

const LOCKING_KEY = randomBytes(32);
const VISITOR_KEY = randomBytes(32).toString("hex");
const INVITE_CODE = "4HQX-7MRT-2KPD-9WVA";
const ACCESS_CODE = "K7QM-3XPD-9RTA-W2FH";
const SESSION_TOKEN = "jTok_6Hn3k2LqP9sVwXyZ0aBcDeFgHiJkLmNoPqRsTuV";
const OWNER_ACCESS_CODE = "Z9Y8-X7W6-V5T4-S3R2";
const CUSTOMER = "c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const HOUSEHOLD = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION = "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";
const SNEAKY = "f9e8d7c6-b5a4-4f3e-8d2c-1b0a9f8e7d6c";

const FORM: JoinInput = {
  inviteCode: "4hqx 7mrt 2kpd 9wva",
  fullName: "Tunde Okafor",
  phone: "000 1234 5678",
  dateOfBirth: "1988-03-02",
  role: "wife",
  nin: "00011112222",
  bvn: "00033334444",
  testTermsAccepted: true,
};

const CONTEXT: JoinContext = { address: "203.0.113.7", isDevelopment: false, now: new Date("2026-11-27T11:00:00Z") };
const JOINED: JoinHouseholdResult = { status: "joined", customerId: CUSTOMER, householdId: HOUSEHOLD, sessionId: SESSION };

const SECRETS = [
  INVITE_CODE,
  INVITE_CODE.replace(/-/g, ""),
  "4hqx 7mrt 2kpd 9wva",
  inviteCodeFingerprint(INVITE_CODE),
  ACCESS_CODE,
  ACCESS_CODE.replace(/-/g, ""),
  accessCodeFingerprint(ACCESS_CODE),
  OWNER_ACCESS_CODE,
  SESSION_TOKEN,
  sessionTokenFingerprint(SESSION_TOKEN),
  CUSTOMER,
  HOUSEHOLD,
  SESSION,
  "00011112222",
  "00033334444",
  "00012345678",
];

function assertNothingSecret(value: unknown, allowToken = false): void {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    if (allowToken && secret === SESSION_TOKEN) {
      continue;
    }
    assert.ok(!text.includes(secret), "the result holds something it must not");
  }
}

function standIn(changes: Partial<JoinDeps> = {}, answer: JoinHouseholdResult | (() => never) = JOINED) {
  const calls: JoinHouseholdArgs[] = [];
  let made = 0;
  const deps: JoinDeps = {
    writesEnabled: () => true,
    signupsEnabled: () => true,
    accessCodeKeys: () => new Map([[1, LOCKING_KEY]]),
    visitorKey: () => VISITOR_KEY,
    joinHousehold: async (args) => {
      calls.push(args);
      if (typeof answer === "function") {
        return answer();
      }
      return answer;
    },
    generateAccessCode: () => {
      made += 1;
      return ACCESS_CODE;
    },
    generateSessionToken: () => {
      made += 1;
      return SESSION_TOKEN;
    },
    ...changes,
  };
  return { deps, calls, made: () => made };
}

describe("runJoin: the early exits make no database call", () => {
  it("money movement switched off: paused first, even with sign-ups off and no secrets", async () => {
    const s = standIn({ writesEnabled: () => false, signupsEnabled: () => false, accessCodeKeys: () => null });
    assert.deepEqual(await runJoin(FORM, CONTEXT, s.deps), { status: "paused", message: SIGNUPS_PAUSED_SENTENCE });
    assert.equal(s.calls.length, 0);
    assert.equal(s.made(), 0);
  });

  it("sign-ups switched off: the paused sentence", async () => {
    const s = standIn({ signupsEnabled: () => false });
    assert.deepEqual(await runJoin(FORM, CONTEXT, s.deps), { status: "paused", message: "New sign-ups are paused right now." });
    assert.equal(s.calls.length, 0);
  });

  it("a missing locking key or visitor key: the unknown sentence, no call", async () => {
    for (const changes of [{ accessCodeKeys: () => null }, { visitorKey: () => null }, { accessCodeKeys: () => new Map([[2, LOCKING_KEY]]) }]) {
      const s = standIn(changes);
      assert.deepEqual(await runJoin(FORM, CONTEXT, s.deps), { status: "refused", code: "unknown", message: signUpRefusalSentence("unknown") });
      assert.equal(s.calls.length, 0);
    }
  });

  it("invalid details: the same sentences as sign-up, and no call", async () => {
    const s = standIn();
    const result = await runJoin({ ...FORM, phone: "08012345678", fullName: "A", testTermsAccepted: false }, CONTEXT, s.deps);
    assert.equal(result.status, "field_errors");
    if (result.status === "field_errors") {
      assert.equal(result.fields.phone?.problem, "not_test_number");
      assert.equal(result.fields.fullName?.problem, "too_short");
      assert.equal(result.fields.testTermsAccepted?.problem, "not_ticked");
      assert.equal(result.fields.householdName, undefined);
    }
    assert.equal(s.calls.length, 0);
    assert.equal(s.made(), 0);
  });

  it("a NIN ending in 99: not verified, with the sign-up sentence, and no call", async () => {
    const s = standIn();
    assert.deepEqual(await runJoin({ ...FORM, bvn: "00033334499" }, CONTEXT, s.deps), {
      status: "not_verified",
      message: "We could not verify these details. This is a simulated check.",
    });
    assert.equal(s.calls.length, 0);
  });

  it("either role is allowed", async () => {
    for (const role of ["husband", "wife"]) {
      const s = standIn();
      assert.equal((await runJoin({ ...FORM, role }, CONTEXT, s.deps)).status, "ok");
    }
  });
});

describe("runJoin: the call", () => {
  it("sends only fingerprints and the locked copy, never the plain codes or token", async () => {
    const s = standIn();
    await runJoin(FORM, CONTEXT, s.deps);
    const sent = JSON.stringify(s.calls[0]);
    for (const plain of [INVITE_CODE, INVITE_CODE.replace(/-/g, ""), "4hqx 7mrt 2kpd 9wva", ACCESS_CODE, ACCESS_CODE.replace(/-/g, ""), SESSION_TOKEN]) {
      assert.ok(!sent.includes(plain));
    }
    const args = s.calls[0];
    assert.equal(args.inviteHash, inviteCodeFingerprint(INVITE_CODE));
    assert.equal(args.codeHash, accessCodeFingerprint(ACCESS_CODE));
    assert.equal(decryptAccessCode(args.codeEncrypted, LOCKING_KEY), ACCESS_CODE);
    assert.equal(args.tokenHash, sessionTokenFingerprint(SESSION_TOKEN));
  });

  it("sends the approved limits, and no household anything", async () => {
    const s = standIn();
    await runJoin(FORM, CONTEXT, s.deps);
    const args = s.calls[0];
    assert.equal(args.maxSignUpsPerVisitor, 3);
    assert.equal(args.maxCustomersPerDay, 50);
    assert.equal(args.maxCustomersTotal, 300);
    assert.equal(args.maxWrongInvitesPer15Minutes, 5);
    assert.equal(args.maxWrongInvitesPer24Hours, 20);
    assert.equal(args.phone, "00012345678");
    assert.ok(!Object.keys(args).some((name) => /household/i.test(name)));
  });

  it("garbage in the invite box is still fingerprinted and sent, so it is counted", async () => {
    for (const typed of ["", "hello", 42, undefined]) {
      const s = standIn({}, { status: "invite_not_valid" });
      await runJoin({ ...FORM, inviteCode: typed }, CONTEXT, s.deps);
      assert.equal(s.calls.length, 1);
      assert.equal(s.calls[0].inviteHash, inviteCodeFingerprint(typed));
    }
  });

  it("joined gives only ok and the session token", async () => {
    const result = await runJoin(FORM, CONTEXT, standIn().deps);
    assert.deepEqual(result, { status: "ok", sessionToken: SESSION_TOKEN });
    assertNothingSecret(result, true);
  });

  it("invite_not_valid and too_many_attempts give the approved sentences", async () => {
    assert.deepEqual(await runJoin(FORM, CONTEXT, standIn({}, { status: "invite_not_valid" }).deps), {
      status: "refused",
      code: "invite_not_valid",
      message: "That invite code did not work. Check it with your partner and try again.",
    });
    assert.deepEqual(await runJoin(FORM, CONTEXT, standIn({}, { status: "too_many_attempts" }).deps), {
      status: "refused",
      code: "too_many_attempts",
      message: signInSentence("too_many_attempts"),
    });
  });

  for (const code of [...JOIN_REFUSAL_CODES, "unknown"] as const) {
    it(`a ${code} refusal maps to its fixed sentence, with nothing secret`, async () => {
      const result = await runJoin(FORM, CONTEXT, standIn({}, { status: "refused", code }).deps);
      assert.deepEqual(result, { status: "refused", code, message: joinSentence(code) });
      assertNothingSecret(result);
    });
  }

  it("a call that throws gives the unknown sentence; no second call", async () => {
    const s = standIn({}, () => {
      throw new Error("down");
    });
    assert.deepEqual(await runJoin(FORM, CONTEXT, s.deps), { status: "refused", code: "unknown", message: signUpRefusalSentence("unknown") });
    assert.equal(s.calls.length, 1);
  });
});

describe("runJoinAction", () => {
  function formWith(values: Record<string, string>): FormData {
    const form = new FormData();
    for (const [name, value] of Object.entries(values)) {
      form.append(name, value);
    }
    return form;
  }

  const TYPED = {
    invite_code: "4hqx 7mrt 2kpd 9wva",
    full_name: "Tunde Okafor",
    phone: "00012345678",
    date_of_birth: "1988-03-02",
    role: "husband",
    nin: "00011112222",
    bvn: "00033334444",
    terms: "on",
  };

  function action(answer: JoinHouseholdResult, changes: Partial<JoinDeps> = {}) {
    const s = standIn(changes, answer);
    const cookies: string[] = [];
    const deps: JoinActionDeps = {
      join: (rawForm, context) => runJoin(rawForm, context, s.deps),
      getContext: async () => ({ address: "203.0.113.7", isDevelopment: false }),
      setCookie: (token) => {
        cookies.push(token);
      },
      now: () => new Date("2026-11-27T11:00:00Z"),
    };
    return { deps, cookies, calls: s.calls };
  }

  it("reads only the eight named fields", () => {
    const asked: string[] = [];
    readJoinForm({ get: (name) => (asked.push(name), null) });
    assert.deepEqual(asked.sort(), ["bvn", "date_of_birth", "full_name", "invite_code", "nin", "phone", "role", "terms"]);
  });

  it("a household_id in the form never reaches the database", async () => {
    const a = action(JOINED);
    await runJoinAction(formWith({ ...TYPED, household_id: SNEAKY, household: SNEAKY, customer_id: SNEAKY }), a.deps);
    assert.ok(!JSON.stringify(a.calls).includes(SNEAKY));
  });

  it("joined: the cookie is set once and the next stop is /welcome", async () => {
    const a = action(JOINED);
    const outcome = await runJoinAction(formWith(TYPED), a.deps);
    assert.deepEqual(outcome, { redirectTo: "/welcome" });
    assert.deepEqual(a.cookies, [SESSION_TOKEN]);
    assertNothingSecret(outcome);
  });

  for (const [label, answer, sentence] of [
    ["invite_not_valid", { status: "invite_not_valid" }, "That invite code did not work. Check it with your partner and try again."],
    ["too_many_attempts", { status: "too_many_attempts" }, "Too many attempts. Please wait 15 minutes and try again."],
  ] as const) {
    it(`${label}: no cookie, the approved sentence, nothing secret`, async () => {
      const a = action(answer as JoinHouseholdResult);
      const outcome = await runJoinAction(formWith(TYPED), a.deps);
      assert.deepEqual(outcome, { status: "refused", fields: {}, message: sentence });
      assert.equal(a.cookies.length, 0);
      assertNothingSecret(outcome);
    });
  }

  it("every other outcome sets no cookie and holds nothing secret", async () => {
    const cases: Array<[JoinHouseholdResult, Partial<JoinDeps>, Record<string, string>]> = [
      [JOINED, { writesEnabled: () => false }, TYPED],
      [JOINED, { signupsEnabled: () => false }, TYPED],
      [JOINED, {}, { ...TYPED, phone: "08012345678" }],
      [JOINED, {}, { ...TYPED, nin: "00011112299" }],
      [{ status: "refused", code: "limit_total" }, {}, TYPED],
      [{ status: "refused", code: "unknown" }, {}, TYPED],
    ];
    for (const [answer, changes, values] of cases) {
      const a = action(answer, changes);
      const outcome = await runJoinAction(formWith(values), a.deps);
      assert.ok(!("redirectTo" in outcome));
      assert.equal(a.cookies.length, 0);
      assertNothingSecret(outcome);
      assert.ok(!JSON.stringify(outcome).includes("08012345678"));
      assert.deepEqual(Object.keys(outcome).sort(), ["fields", "message", "status"]);
    }
  });

  it("the general sentence shows for everything but a field problem", async () => {
    const paused = (await runJoinAction(formWith(TYPED), action(JOINED, { writesEnabled: () => false }).deps)) as JoinFormState;
    assert.equal(joinGeneralSentence(paused), SIGNUPS_PAUSED_SENTENCE);
    const field = (await runJoinAction(formWith({ ...TYPED, phone: "x" }), action(JOINED).deps)) as JoinFormState;
    assert.equal(field.status, "field_errors");
    assert.equal(joinGeneralSentence(field), null);
    assert.equal(joinGeneralSentence(INITIAL_JOIN_STATE), null);
  });
});
