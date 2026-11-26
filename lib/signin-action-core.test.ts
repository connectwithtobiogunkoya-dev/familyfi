// Tests for the sign-in form's server action, and the sign-in page's
// source files.
//
// Run with:  npm test
//
// Stand-ins replace the sign-in, the request details and the cookie. No
// real database is used.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { accessCodeFingerprint, tidyAccessCode } from "./access-code.ts";
import type { SignInCallResult } from "./auth-db-core.ts";
import { signInSentence } from "./auth-limits.ts";
import { runSignInAction, type SignInActionDeps } from "./signin-action-core.ts";
import { runSignIn, type SignInContext, type SignInResult } from "./signin-core.ts";
import { INITIAL_SIGN_IN_STATE } from "./signin-form-state.ts";

const SESSION_TOKEN = "iTok_5Hn3k2LqP9sVwXyZ0aBcDeFgHiJkLmNoPqRsTuV";
const TYPED_CODE = "k7qm 3xpd-9rta w2fh";
const SNEAKY = "a9999999-9999-4999-8999-999999999999";

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    form.append(name, value);
  }
  return form;
}

function standIn(answer: SignInResult | (() => never)) {
  const seen: Array<{ typedCode: unknown; context: SignInContext }> = [];
  const cookies: string[] = [];
  const deps: SignInActionDeps = {
    signIn: async (typedCode, context) => {
      seen.push({ typedCode, context });
      if (typeof answer === "function") {
        return answer();
      }
      return answer;
    },
    getContext: async () => ({ address: "203.0.113.7", isDevelopment: false }),
    setCookie: (token) => {
      cookies.push(token);
    },
  };
  return { deps, seen, cookies };
}

function assertNothingSecret(value: unknown, typed: string): void {
  const text = JSON.stringify(value);
  for (const secret of [SESSION_TOKEN, typed, tidyAccessCode(typed), accessCodeFingerprint(typed)]) {
    if (secret.length > 0) {
      assert.ok(!text.includes(secret), "the returned value holds something it must not");
    }
  }
}

const REFUSALS = ["wrong_code", "too_many_attempts", "no_household", "unknown"] as const;

describe("runSignInAction: only access_code is read", () => {
  it("other fields never reach the sign-in", async () => {
    const s = standIn({ status: "refused", reason: "wrong_code", message: signInSentence("wrong_code") });
    await runSignInAction(
      formWith({ access_code: TYPED_CODE, household_id: SNEAKY, customer_id: SNEAKY, session: SNEAKY, address: "198.51.100.1" }),
      s.deps,
    );
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].typedCode, TYPED_CODE);
    assert.ok(!JSON.stringify(s.seen[0]).includes(SNEAKY));
    assert.deepEqual(s.seen[0].context, { address: "203.0.113.7" });
  });

  it("asks the form for no other name", async () => {
    const asked: string[] = [];
    await runSignInAction({ get: (name) => (asked.push(name), null) }, standIn({ status: "refused", reason: "wrong_code", message: "" }).deps);
    assert.deepEqual(asked, ["access_code"]);
  });

  it("garbage is still passed on as it was typed, so it is counted", async () => {
    for (const typed of ["", "hello", "UUUU", "x".repeat(300), "'; drop table x; --"]) {
      const s = standIn({ status: "refused", reason: "wrong_code", message: signInSentence("wrong_code") });
      await runSignInAction(formWith({ access_code: typed }), s.deps);
      assert.equal(s.seen.length, 1);
      assert.equal(s.seen[0].typedCode, typed);
    }
  });

  it("a missing field is passed on too (as null)", async () => {
    const s = standIn({ status: "refused", reason: "wrong_code", message: signInSentence("wrong_code") });
    await runSignInAction(formWith({}), s.deps);
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].typedCode, null);
  });
});

describe("runSignInAction: a right code", () => {
  it("passes the token to setCookie exactly once and says to go to /app", async () => {
    const s = standIn({ status: "ok", sessionToken: SESSION_TOKEN });
    const outcome = await runSignInAction(formWith({ access_code: TYPED_CODE }), s.deps);
    assert.deepEqual(outcome, { redirectTo: "/app" });
    assert.deepEqual(s.cookies, [SESSION_TOKEN]);
    assertNothingSecret(outcome, TYPED_CODE);
  });

  it("a cookie that cannot be set gives the unknown sentence, not a redirect", async () => {
    const s = standIn({ status: "ok", sessionToken: SESSION_TOKEN });
    const outcome = await runSignInAction(formWith({ access_code: TYPED_CODE }), {
      ...s.deps,
      setCookie: () => {
        throw new Error("no");
      },
    });
    assert.deepEqual(outcome, { status: "unknown", message: signInSentence("unknown") });
    assertNothingSecret(outcome, TYPED_CODE);
  });
});

describe("runSignInAction: every refusal", () => {
  for (const reason of REFUSALS) {
    it(`${reason}: its sentence only, no cookie, nothing secret`, async () => {
      const s = standIn({ status: "refused", reason, message: "a message the action must not pass on" });
      const outcome = await runSignInAction(formWith({ access_code: TYPED_CODE }), s.deps);
      assert.deepEqual(outcome, { status: reason, message: signInSentence(reason) });
      assert.equal(s.cookies.length, 0);
      assertNothingSecret(outcome, TYPED_CODE);
    });
  }

  it("the sentences are the approved ones", async () => {
    const wrong = await runSignInAction(formWith({ access_code: "x" }), standIn({ status: "refused", reason: "wrong_code", message: "" }).deps);
    assert.equal((wrong as { message: string }).message, "That access code did not work. Check it and try again.");
    const many = await runSignInAction(formWith({ access_code: "x" }), standIn({ status: "refused", reason: "too_many_attempts", message: "" }).deps);
    assert.equal((many as { message: string }).message, "Too many attempts. Please wait 15 minutes and try again.");
  });

  it("a sign-in that throws gives the unknown sentence and no cookie", async () => {
    const s = standIn(() => {
      throw new Error("down");
    });
    assert.deepEqual(await runSignInAction(formWith({ access_code: TYPED_CODE }), s.deps), { status: "unknown", message: signInSentence("unknown") });
    assert.equal(s.cookies.length, 0);
  });

  it("the starting state shows nothing", () => {
    assert.deepEqual(INITIAL_SIGN_IN_STATE, { status: "idle", message: null });
  });
});

describe("runSignInAction with the real sign-in rules and a stand-in database", () => {
  const VISITOR_KEY = randomBytes(32).toString("hex");

  function realRules(answer: SignInCallResult) {
    const sentHashes: string[] = [];
    const s = standIn({ status: "refused", reason: "unknown", message: "" });
    const deps: SignInActionDeps = {
      ...s.deps,
      signIn: (typedCode, context) =>
        runSignIn(typedCode, context, {
          visitorKey: () => VISITOR_KEY,
          signInWithCode: async (args) => {
            sentHashes.push(args.codeHash);
            return answer;
          },
          generateSessionToken: () => SESSION_TOKEN,
        }),
    };
    return { deps, cookies: s.cookies, sentHashes };
  }

  const answers: SignInCallResult[] = [
    { status: "signed_in", customerId: "c1111111-1111-4111-8111-111111111111", householdId: "a2222222-2222-4222-8222-222222222222" },
    { status: "wrong_code" },
    { status: "too_many_attempts" },
    { status: "no_household" },
    { status: "unknown" },
  ];

  for (const answer of answers) {
    it(`${answer.status}: the typed code, its tidy form, its fingerprint and the token appear nowhere`, async () => {
      const r = realRules(answer);
      const outcome = await runSignInAction(formWith({ access_code: TYPED_CODE }), r.deps);
      assertNothingSecret(outcome, TYPED_CODE);
      assert.deepEqual(r.sentHashes, [accessCodeFingerprint(TYPED_CODE)]);
      assert.equal(r.cookies.length, answer.status === "signed_in" ? 1 : 0);
    });
  }
});

describe("the /sign-in and sign-out source files", () => {
  const folders = ["../app/sign-in/", "../app/sign-out/"];
  const files = [
    ...folders.flatMap((folder) =>
      readdirSync(new URL(folder, import.meta.url))
        .filter((name) => /\.(ts|tsx|css)$/.test(name))
        .map((name) => new URL(folder + name, import.meta.url)),
    ),
    new URL("./signin-action-core.ts", import.meta.url),
    new URL("./signin-form-state.ts", import.meta.url),
    new URL("./sign-out-action-core.ts", import.meta.url),
    new URL("../app/welcome/sign-out-button.tsx", import.meta.url),
  ];

  it("there are source files to check", () => {
    assert.ok(files.length >= 8);
  });

  for (const file of files) {
    const label = file.pathname.split("/familyfi/")[1] ?? file.pathname;
    it(`${label}: no console calls, and neither forbidden word`, () => {
      const source = readFileSync(file, "utf8");
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }
});
