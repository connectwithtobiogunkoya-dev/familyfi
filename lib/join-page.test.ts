// Tests for the Join page: its action's behaviour with stand-ins, and
// source checks on /join, the shared fields and the new links.
//
// Run with:  npm test
//
// Stand-ins replace the switch, the secrets, the request and the database.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { accessCodeFingerprint } from "./access-code.ts";
import type { JoinHouseholdArgs, JoinHouseholdResult } from "./auth-db-core.ts";
import { checkIdentity } from "./identity.ts";
import { inviteCodeFingerprint } from "./invite-code.ts";
import { runJoinAction, type JoinActionDeps } from "./join-action-core.ts";
import { runJoin, type JoinDeps } from "./join-core.ts";
import type { JoinFormState } from "./join-form-state.ts";
import { sessionTokenFingerprint } from "./session-token.ts";

const LOCKING_KEY = randomBytes(32);
const VISITOR_KEY = randomBytes(32).toString("hex");
const ACCESS_CODE = "K7QM-3XPD-9RTA-W2FH";
const SESSION_TOKEN = "pTok_2Hn3k2LqP9sVwXyZ0aBcDeFgHiJkLmNoPqRsTuV";
const TYPED_INVITE = "4hqx 7mrt-2kpd 9wva";
const CUSTOMER = "c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const HOUSEHOLD = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION = "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";
const NOT_VALID = "That invite code did not work. Check it with your partner and try again.";
const TOO_MANY = "Too many attempts. Please wait 15 minutes and try again.";

const TYPED = {
  invite_code: TYPED_INVITE,
  full_name: "Tunde Okafor",
  phone: "00012345678",
  date_of_birth: "1988-03-02",
  role: "husband",
  nin: "00011112222",
  bvn: "00033334444",
  terms: "on",
};

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    form.append(name, value);
  }
  return form;
}

// The action logic wired to the real join rules and a stand-in database.
function joinPage(answer: JoinHouseholdResult, changes: Partial<JoinDeps> = {}) {
  const calls: JoinHouseholdArgs[] = [];
  const cookies: string[] = [];
  const join: JoinDeps = {
    signupsEnabled: () => true,
    accessCodeKeys: () => new Map([[1, LOCKING_KEY]]),
    visitorKey: () => VISITOR_KEY,
    joinHousehold: async (args) => {
      calls.push(args);
      return answer;
    },
    generateAccessCode: () => ACCESS_CODE,
    generateSessionToken: () => SESSION_TOKEN,
    ...changes,
  };
  const deps: JoinActionDeps = {
    join: (rawForm, context) => runJoin(rawForm, context, join),
    getContext: async () => ({ address: "203.0.113.7", isDevelopment: false }),
    setCookie: (token) => {
      cookies.push(token);
    },
    now: () => new Date("2026-11-27T11:00:00Z"),
  };
  return { deps, calls, cookies };
}

const JOINED: JoinHouseholdResult = { status: "joined", customerId: CUSTOMER, householdId: HOUSEHOLD, sessionId: SESSION };

// Nothing the page may never show: the invite code in any form, any
// fingerprint, any id, the token or the new access code.
function assertNothingExposed(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of [
    TYPED_INVITE,
    "4HQX-7MRT-2KPD-9WVA",
    "4HQX7MRT2KPD9WVA",
    inviteCodeFingerprint(TYPED_INVITE),
    accessCodeFingerprint(ACCESS_CODE),
    ACCESS_CODE,
    SESSION_TOKEN,
    sessionTokenFingerprint(SESSION_TOKEN),
    CUSTOMER,
    HOUSEHOLD,
    SESSION,
  ]) {
    assert.ok(!text.includes(secret), "something is exposed that must not be");
  }
}

describe("the Join action", () => {
  it("SIGNUPS_ENABLED off: the paused sentence, and no database call", async () => {
    const p = joinPage(JOINED, { signupsEnabled: () => false });
    const outcome = await runJoinAction(formWith(TYPED), p.deps);
    assert.deepEqual(outcome, { status: "paused", fields: {}, message: "New sign-ups are paused right now." });
    assert.equal(p.calls.length, 0);
    assert.equal(p.cookies.length, 0);
  });

  it("detail errors: no database call, and exactly the sign-up sentences", async () => {
    const bad = { ...TYPED, full_name: "A", phone: "08012345678", date_of_birth: "2015-01-01", terms: "" };
    const p = joinPage(JOINED);
    const outcome = (await runJoinAction(formWith(bad), p.deps)) as JoinFormState;
    assert.equal(p.calls.length, 0);
    assert.equal(outcome.status, "field_errors");
    // The same checker sign-up uses, on the same values, gives the same sentences.
    const signUpCheck = checkIdentity(
      { fullName: "A", phone: "08012345678", dateOfBirth: "2015-01-01", role: "husband", nin: "00011112222", bvn: "00033334444", householdName: "", testTermsAccepted: false },
      new Date("2026-11-27T11:00:00Z"),
    );
    assert.equal(signUpCheck.outcome, "field_errors");
    if (signUpCheck.outcome === "field_errors") {
      for (const [field, error] of Object.entries(signUpCheck.fields)) {
        assert.equal(outcome.fields[field as keyof typeof outcome.fields], error?.message, field);
      }
    }
    assert.equal(outcome.message, null);
  });

  it("a NIN ending in 99: the sign-up not-verified sentence, and no database call", async () => {
    const p = joinPage(JOINED);
    const outcome = await runJoinAction(formWith({ ...TYPED, nin: "00011112299" }), p.deps);
    assert.deepEqual(outcome, { status: "not_verified", fields: {}, message: "We could not verify these details. This is a simulated check." });
    assert.equal(p.calls.length, 0);
  });

  it("a wrong, used, expired, voided or full invite: the one general sentence, and no cookie", async () => {
    // The database gives invite_not_valid for all five causes alike, so the
    // page has no way to tell them apart, and shows one sentence.
    for (let cause = 0; cause < 5; cause += 1) {
      const p = joinPage({ status: "invite_not_valid" });
      const outcome = await runJoinAction(formWith(TYPED), p.deps);
      assert.deepEqual(outcome, { status: "refused", fields: {}, message: NOT_VALID });
      assert.equal(p.cookies.length, 0);
      assertNothingExposed(outcome);
    }
  });

  it("too many attempts: the too-many sentence, and no cookie", async () => {
    const p = joinPage({ status: "too_many_attempts" });
    const outcome = await runJoinAction(formWith(TYPED), p.deps);
    assert.deepEqual(outcome, { status: "refused", fields: {}, message: TOO_MANY });
    assert.equal(p.cookies.length, 0);
    assertNothingExposed(outcome);
  });

  it("joined: the cookie is set once, and the next stop is /welcome", async () => {
    const p = joinPage(JOINED);
    const outcome = await runJoinAction(formWith(TYPED), p.deps);
    assert.deepEqual(outcome, { redirectTo: "/welcome" });
    assert.deepEqual(p.cookies, [SESSION_TOKEN]);
    assertNothingExposed(outcome);
  });

  it("the invite code is never echoed back, in any form, after any refusal", async () => {
    const answers: JoinHouseholdResult[] = [
      { status: "invite_not_valid" },
      { status: "too_many_attempts" },
      { status: "refused", code: "limit_total" },
      { status: "refused", code: "bad_request" },
      { status: "refused", code: "unknown" },
    ];
    for (const answer of answers) {
      const outcome = await runJoinAction(formWith(TYPED), joinPage(answer).deps);
      assertNothingExposed(outcome);
      assert.deepEqual(Object.keys(outcome).sort(), ["fields", "message", "status"]);
      assert.ok(!("inviteCode" in (outcome as JoinFormState).fields));
    }
    const fieldError = await runJoinAction(formWith({ ...TYPED, phone: "x" }), joinPage(JOINED).deps);
    assertNothingExposed(fieldError);
  });

  it("a household or person named in the form never reaches the database", async () => {
    const SNEAKY = "f9e8d7c6-b5a4-4f3e-8d2c-1b0a9f8e7d6c";
    const p = joinPage(JOINED);
    await runJoinAction(formWith({ ...TYPED, household_id: SNEAKY, customer_id: SNEAKY, household_name: "Mine" }), p.deps);
    assert.ok(!JSON.stringify(p.calls).includes(SNEAKY));
    assert.ok(!JSON.stringify(p.calls).includes("Mine"));
  });
});

describe("source checks", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const code = (text: string) => text.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const JOIN_FILES = readdirSync(new URL("../app/join/", import.meta.url)).map((name) => `../app/join/${name}`);

  it("finds the Join page's files", () => {
    assert.deepEqual(JOIN_FILES.map((p) => p.split("/").pop()).sort(), ["actions.ts", "join-form.tsx", "page.tsx", "submit-button.tsx"]);
  });

  for (const path of [...JOIN_FILES, "../app/sign-up/identity-fields.tsx", "../app/page.tsx", "../app/sign-in/page.tsx"]) {
    it(`${path}: no console calls, no forbidden words, no em dashes`, () => {
      const source = read(path);
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }

  it("the action reads no household or person from the form, and uses runJoinAction", () => {
    const action = code(read("../app/join/actions.ts"));
    assert.match(action, /runJoinAction\(formData,/);
    assert.ok(!/formData\.get|household_id|customer_id|householdId|customerId/.test(action));
  });

  it("the Join form has no household name field, and the Invite code box comes before the details", () => {
    const form = code(read("../app/join/join-form.tsx"));
    assert.ok(!/household_name|householdName|Household name/.test(form));
    assert.ok(form.indexOf('name="invite_code"') < form.indexOf("<PersonFields"));
    assert.match(form, /autoComplete="off"/);
  });

  it("the page checks SIGNUPS_ENABLED before it shows the form, and waits for a visit", () => {
    const page = code(read("../app/join/page.tsx"));
    assert.ok(page.indexOf("await connection()") < page.indexOf("signupsEnabled()"));
    assert.ok(page.indexOf("signupsEnabled()") < page.indexOf("<JoinForm"));
    assert.match(page, /Join a household/);
    assert.match(page, /Ask your partner for their invite code\. This is a test environment\. Use test numbers only: 11 digits starting\s+with 000\. A number ending in 99 shows a failed check\./);
  });

  it("the button reads Join household, and Checking your identity... while sending", () => {
    const button = read("../app/join/submit-button.tsx");
    assert.match(button, /pending \? "Checking your identity\.\.\." : "Join household"/);
    assert.match(button, /disabled=\{pending\}/);
  });

  it("/ and /sign-in link to /join with \"I have an invite code\", and keep their buttons", () => {
    const home = read("../app/page.tsx");
    assert.match(home, /<a href="\/join" className=\{styles\.inviteLink\}>\s+I have an invite code/);
    assert.match(home, /href="\/sign-up"/);
    assert.match(home, /href="\/sign-in"/);
    const signIn = read("../app/sign-in/page.tsx");
    assert.match(signIn, /<a href="\/join" className=\{styles\.inviteLink\}>\s+I have an invite code/);
    assert.match(signIn, /<SignInForm \/>/);
    assert.match(signIn, /Create your household/);
  });

  it("sign-up still asks for the household name, through the shared fields for the rest", () => {
    const signUp = read("../app/sign-up/sign-up-form.tsx");
    assert.match(signUp, /name="household_name"/);
    assert.match(signUp, /<PersonFields /);
    assert.match(signUp, /<TermsField /);
  });
});
