// Tests for the sign-up form's server action, and the sign-up pages'
// source files.
//
// Run with:  npm test
//
// Stand-ins replace the sign-up, the request details and the cookie. No
// real database is used and nothing is created.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { signUpRefusalSentence } from "./auth-limits.ts";
import type { IdentityInput } from "./identity.ts";
import { readSignUpForm, runSignUpAction, type SignUpActionDeps } from "./signup-action-core.ts";
import { runSignUp, type SignUpContext, type SignUpResult } from "./signup-core.ts";
import { generalSentence, INITIAL_SIGN_UP_STATE, SIGNUPS_PAUSED_SENTENCE, type SignUpFormState } from "./signup-form-state.ts";

const SESSION_TOKEN = "aTok_7Hn3k2LqP9sVwXyZ0aBcDeFgHiJkLmNoPqRsTuV";
const ACCESS_CODE = "K7QM-3XPD-9RTA-W2FH";
const SNEAKY_HOUSEHOLD = "a9999999-9999-4999-8999-999999999999";

const TYPED = {
  full_name: "Ada Okafor",
  phone: "00012345678",
  date_of_birth: "1990-05-17",
  role: "wife",
  nin: "00011112222",
  bvn: "00033334444",
  household_name: "Okafor home",
  terms: "on",
};

const TYPED_SECRETS = ["Ada Okafor", "00012345678", "1990-05-17", "00011112222", "00033334444", "Okafor home", SESSION_TOKEN, ACCESS_CODE, ACCESS_CODE.replace(/-/g, "")];

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    form.append(name, value);
  }
  return form;
}

function standIn(answer: SignUpResult | (() => never)) {
  const seen: Array<{ rawForm: IdentityInput; context: SignUpContext }> = [];
  const cookies: string[] = [];
  const deps: SignUpActionDeps = {
    signUp: async (rawForm, context) => {
      seen.push({ rawForm, context });
      if (typeof answer === "function") {
        return answer();
      }
      return answer;
    },
    getContext: async () => ({ address: "203.0.113.7", isDevelopment: false }),
    setCookie: (token) => {
      cookies.push(token);
    },
    now: () => new Date("2026-11-26T11:00:00Z"),
  };
  return { deps, seen, cookies };
}

function assertNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of TYPED_SECRETS) {
    assert.ok(!text.includes(secret), `the returned value contains ${secret.length} characters it must not`);
  }
}

const NON_OK: Array<[label: string, result: SignUpResult]> = [
  ["paused", { status: "paused" }],
  ["field problems", { status: "field_errors", fields: { phone: { problem: "not_test_number", message: "phone sentence" } } }],
  ["not verified", { status: "not_verified", message: signUpRefusalSentence("not_verified") }],
  ["limit_visitor", { status: "refused", code: "limit_visitor", message: signUpRefusalSentence("limit_visitor") }],
  ["limit_daily", { status: "refused", code: "limit_daily", message: signUpRefusalSentence("limit_daily") }],
  ["limit_total", { status: "refused", code: "limit_total", message: signUpRefusalSentence("limit_total") }],
  ["under_18", { status: "refused", code: "under_18", message: signUpRefusalSentence("under_18") }],
  ["unknown", { status: "refused", code: "unknown", message: signUpRefusalSentence("unknown") }],
];

describe("readSignUpForm: only the eight named fields", () => {
  it("reads each field by its form name", () => {
    assert.deepEqual(readSignUpForm(formWith(TYPED)), {
      fullName: "Ada Okafor",
      phone: "00012345678",
      dateOfBirth: "1990-05-17",
      role: "wife",
      nin: "00011112222",
      bvn: "00033334444",
      householdName: "Okafor home",
      testTermsAccepted: true,
    });
  });

  it("the terms box counts as ticked only when it sends on", () => {
    assert.equal(readSignUpForm(formWith({ ...TYPED, terms: "yes" })).testTermsAccepted, false);
    const { terms: _terms, ...withoutTerms } = TYPED;
    assert.equal(readSignUpForm(formWith(withoutTerms)).testTermsAccepted, false);
  });

  it("asks the form for no other name", () => {
    const asked: string[] = [];
    readSignUpForm({ get: (name) => (asked.push(name), null) });
    assert.deepEqual(asked.sort(), ["bvn", "date_of_birth", "full_name", "household_name", "nin", "phone", "role", "terms"]);
  });
});

describe("runSignUpAction: extra fields are ignored", () => {
  it("household_id and similar never reach the sign-up", async () => {
    const s = standIn({ status: "ok", sessionToken: SESSION_TOKEN });
    await runSignUpAction(
      formWith({
        ...TYPED,
        household: SNEAKY_HOUSEHOLD,
        household_id: SNEAKY_HOUSEHOLD,
        customer_id: SNEAKY_HOUSEHOLD,
        role_id: SNEAKY_HOUSEHOLD,
        householdId: SNEAKY_HOUSEHOLD,
      }),
      s.deps,
    );
    assert.equal(s.seen.length, 1);
    assert.ok(!JSON.stringify(s.seen[0]).includes(SNEAKY_HOUSEHOLD));
    assert.deepEqual(Object.keys(s.seen[0].rawForm).sort(), [
      "bvn",
      "dateOfBirth",
      "fullName",
      "householdName",
      "nin",
      "phone",
      "role",
      "testTermsAccepted",
    ]);
  });

  it("the context comes from the request, with the time from now()", async () => {
    const s = standIn({ status: "paused" });
    await runSignUpAction(formWith(TYPED), s.deps);
    assert.deepEqual(s.seen[0].context, { address: "203.0.113.7", isDevelopment: false, now: new Date("2026-11-26T11:00:00Z") });
  });
});

describe("runSignUpAction: a good sign-up", () => {
  it("passes the token to setCookie exactly once and says to go to /welcome", async () => {
    const s = standIn({ status: "ok", sessionToken: SESSION_TOKEN });
    const outcome = await runSignUpAction(formWith(TYPED), s.deps);
    assert.deepEqual(outcome, { redirectTo: "/welcome" });
    assert.deepEqual(s.cookies, [SESSION_TOKEN]);
  });

  it("the token appears nowhere in the returned value", async () => {
    const s = standIn({ status: "ok", sessionToken: SESSION_TOKEN });
    const outcome = await runSignUpAction(formWith(TYPED), s.deps);
    assert.ok(!JSON.stringify(outcome).includes(SESSION_TOKEN));
    assertNoSecrets(outcome);
  });

  it("a cookie that cannot be set gives the unknown sentence, not a redirect", async () => {
    const s = standIn({ status: "ok", sessionToken: SESSION_TOKEN });
    const outcome = await runSignUpAction(formWith(TYPED), {
      ...s.deps,
      setCookie: () => {
        throw new Error("no");
      },
    });
    assert.deepEqual(outcome, { status: "refused", fields: {}, message: signUpRefusalSentence("unknown") });
    assertNoSecrets(outcome);
  });
});

describe("runSignUpAction: every other outcome", () => {
  for (const [label, result] of NON_OK) {
    it(`${label}: setCookie is not called, and none of the typed secrets come back`, async () => {
      const s = standIn(result);
      const outcome = await runSignUpAction(formWith(TYPED), s.deps);
      assert.equal(s.cookies.length, 0);
      assert.ok(!("redirectTo" in outcome));
      assertNoSecrets(outcome);
      assert.deepEqual(Object.keys(outcome).sort(), ["fields", "message", "status"]);
    });
  }

  it("paused returns the paused sentence", async () => {
    const outcome = await runSignUpAction(formWith(TYPED), standIn({ status: "paused" }).deps);
    assert.deepEqual(outcome, { status: "paused", fields: {}, message: SIGNUPS_PAUSED_SENTENCE });
    assert.equal(SIGNUPS_PAUSED_SENTENCE, "New sign-ups are paused right now.");
  });

  it("field problems come back per field, as sentences only, with no general sentence", async () => {
    const outcome = await runSignUpAction(
      formWith(TYPED),
      standIn({
        status: "field_errors",
        fields: {
          phone: { problem: "not_test_number", message: "phone sentence" },
          nin: { problem: "missing", message: "nin sentence" },
        },
      }).deps,
    );
    assert.deepEqual(outcome, { status: "field_errors", fields: { phone: "phone sentence", nin: "nin sentence" }, message: null });
  });

  it("a sign-up that throws gives the unknown sentence and no cookie", async () => {
    const s = standIn(() => {
      throw new Error("down");
    });
    assert.deepEqual(await runSignUpAction(formWith(TYPED), s.deps), { status: "refused", fields: {}, message: signUpRefusalSentence("unknown") });
    assert.equal(s.cookies.length, 0);
  });
});

describe("runSignUpAction with the real sign-up rules and a stand-in database", () => {
  const LOCKING_KEY = randomBytes(32);
  const VISITOR_KEY = randomBytes(32).toString("hex");

  function realRules(enabled: boolean, answer: "ok" | "limit_total") {
    let databaseCalls = 0;
    const s = standIn({ status: "paused" });
    const deps: SignUpActionDeps = {
      ...s.deps,
      signUp: (rawForm, context) =>
        runSignUp(rawForm, context, {
          signupsEnabled: () => enabled,
          accessCodeKeys: () => new Map([[1, LOCKING_KEY]]),
          visitorKey: () => VISITOR_KEY,
          createHousehold: async () => {
            databaseCalls += 1;
            return answer === "ok"
              ? { ok: true, customerId: "c1111111-1111-4111-8111-111111111111", householdId: "a2222222-2222-4222-8222-222222222222", sessionId: "e3333333-3333-4333-8333-333333333333" }
              : { ok: false, code: "limit_total" };
          },
          generateAccessCode: () => ACCESS_CODE,
          generateSessionToken: () => SESSION_TOKEN,
        }),
    };
    return { deps, cookies: s.cookies, databaseCalls: () => databaseCalls };
  }

  const forms: Array<[label: string, values: Record<string, string>, enabled: boolean, answer: "ok" | "limit_total"]> = [
    ["switched off", TYPED, false, "ok"],
    ["a bad phone", { ...TYPED, phone: "08012345678" }, true, "ok"],
    ["a NIN ending in 99", { ...TYPED, nin: "00011112299" }, true, "ok"],
    ["the total limit", TYPED, true, "limit_total"],
    ["a pass", TYPED, true, "ok"],
  ];

  for (const [label, values, enabled, answer] of forms) {
    it(`${label}: nothing typed, no code and no token in the returned value`, async () => {
      const r = realRules(enabled, answer);
      const outcome = await runSignUpAction(formWith(values), r.deps);
      assertNoSecrets(outcome);
      assert.ok(!JSON.stringify(outcome).includes("08012345678"));
      assert.ok(!JSON.stringify(outcome).includes("00011112299"));
    });
  }

  it("a pass sets the cookie once; the others set none", async () => {
    const pass = realRules(true, "ok");
    await runSignUpAction(formWith(TYPED), pass.deps);
    assert.deepEqual(pass.cookies, [SESSION_TOKEN]);
    const off = realRules(false, "ok");
    await runSignUpAction(formWith(TYPED), off.deps);
    assert.equal(off.cookies.length, 0);
    assert.equal(off.databaseCalls(), 0);
  });
});

describe("generalSentence: what the form shows above its button", () => {
  for (const [label, result] of NON_OK.filter(([, r]) => r.status !== "field_errors")) {
    it(`${label} shows one general sentence, the one the action returned`, async () => {
      const outcome = (await runSignUpAction(formWith(TYPED), standIn(result).deps)) as SignUpFormState;
      const sentence = generalSentence(outcome);
      assert.equal(typeof sentence, "string");
      assert.ok((sentence as string).length > 0);
      assert.equal(sentence, outcome.message);
    });
  }

  it("a field problem alone shows no general sentence", async () => {
    const outcome = (await runSignUpAction(
      formWith(TYPED),
      standIn({ status: "field_errors", fields: { bvn: { problem: "missing", message: "bvn sentence" } } }).deps,
    )) as SignUpFormState;
    assert.equal(generalSentence(outcome), null);
  });

  it("nothing is shown before the first attempt", () => {
    assert.equal(generalSentence(INITIAL_SIGN_UP_STATE), null);
  });
});

describe("the /sign-up and /welcome source files", () => {
  const folders = ["../app/sign-up/", "../app/welcome/"];
  const files = folders.flatMap((folder) =>
    readdirSync(new URL(folder, import.meta.url))
      .filter((name) => /\.(ts|tsx|css)$/.test(name))
      .map((name) => new URL(folder + name, import.meta.url)),
  );

  it("there are source files to check", () => {
    assert.ok(files.length >= 4);
  });

  for (const file of files) {
    const label = file.pathname.split("/app/")[1];
    it(`${label}: no console calls, and neither forbidden word`, () => {
      const source = readFileSync(file, "utf8");
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }
});
