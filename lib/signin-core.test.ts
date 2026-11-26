// Tests for signing in with an access code.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { accessCodeFingerprint } from "./access-code.ts";
import type { SignInArgs, SignInCallResult } from "./auth-db-core.ts";
import { signInSentence } from "./auth-limits.ts";
import { sessionTokenFingerprint } from "./session-token.ts";
import { runSignIn, type SignInDeps } from "./signin-core.ts";
import { visitorFingerprint } from "./visitor.ts";

const VISITOR_KEY = randomBytes(32).toString("hex");
const SESSION_TOKEN = "sTok_4Hn3k2LqP9sVwXyZ0aBcDeFgHiJkLmNoPqRsTuV";
const CONTEXT = { address: "203.0.113.7" };

function standIn(answer: SignInCallResult | (() => never), changes: Partial<SignInDeps> = {}) {
  const calls: SignInArgs[] = [];
  const deps: SignInDeps = {
    visitorKey: () => VISITOR_KEY,
    signInWithCode: async (args) => {
      calls.push(args);
      if (typeof answer === "function") {
        return answer();
      }
      return answer;
    },
    generateSessionToken: () => SESSION_TOKEN,
    ...changes,
  };
  return { deps, calls };
}

const SIGNED_IN: SignInCallResult = { status: "signed_in", customerId: "c1111111-1111-4111-8111-111111111111", householdId: "a2222222-2222-4222-8222-222222222222" };

describe("runSignIn", () => {
  it("a right code gives only ok and the new session token", async () => {
    const s = standIn(SIGNED_IN);
    assert.deepEqual(await runSignIn("K7QM-3XPD-9RTA-W2FH", CONTEXT, s.deps), { status: "ok", sessionToken: SESSION_TOKEN });
  });

  it("sends the code's fingerprint, the token's fingerprint, the visitor's fingerprint and the approved limits", async () => {
    const s = standIn(SIGNED_IN);
    await runSignIn("k7qm 3xpd 9rta w2fh", CONTEXT, s.deps);
    assert.deepEqual(s.calls[0], {
      codeHash: accessCodeFingerprint("K7QM3XPD9RTAW2FH"),
      tokenHash: sessionTokenFingerprint(SESSION_TOKEN),
      visitorHash: visitorFingerprint("203.0.113.7", VISITOR_KEY),
      maxWrongPer15Minutes: 5,
      maxWrongPer24Hours: 20,
      idleDays: 30,
      absoluteDays: 180,
    });
  });

  it("the plain code is never passed on", async () => {
    const s = standIn(SIGNED_IN);
    await runSignIn("K7QM-3XPD-9RTA-W2FH", CONTEXT, s.deps);
    const sent = JSON.stringify(s.calls[0]);
    assert.ok(!sent.includes("K7QM-3XPD-9RTA-W2FH"));
    assert.ok(!sent.includes("K7QM3XPD9RTAW2FH"));
    assert.ok(!sent.includes(SESSION_TOKEN));
  });

  it("garbage that is not a proper code is still fingerprinted and sent, so it is counted", async () => {
    for (const typed of ["", "hello", "UUUU", "x".repeat(500), 12345]) {
      const s = standIn({ status: "wrong_code" });
      await runSignIn(typed, CONTEXT, s.deps);
      assert.equal(s.calls.length, 1);
      assert.equal(s.calls[0].codeHash, accessCodeFingerprint(typed));
    }
  });

  for (const status of ["wrong_code", "too_many_attempts", "no_household", "unknown"] as const) {
    it(`${status} gives its sentence and no token`, async () => {
      const s = standIn({ status });
      const result = await runSignIn("K7QM-3XPD-9RTA-W2FH", CONTEXT, s.deps);
      assert.deepEqual(result, { status: "refused", reason: status, message: signInSentence(status) });
      assert.ok(!JSON.stringify(result).includes(SESSION_TOKEN));
    });
  }

  it("the sentences are the approved ones", async () => {
    assert.equal(
      (await runSignIn("x", CONTEXT, standIn({ status: "wrong_code" }).deps) as { message: string }).message,
      "That access code did not work. Check it and try again.",
    );
    assert.equal(
      (await runSignIn("x", CONTEXT, standIn({ status: "too_many_attempts" }).deps) as { message: string }).message,
      "Too many attempts. Please wait 15 minutes and try again.",
    );
  });

  it("a missing visitor key fails closed, with no database call", async () => {
    const s = standIn(SIGNED_IN, { visitorKey: () => null });
    assert.deepEqual(await runSignIn("K7QM-3XPD-9RTA-W2FH", CONTEXT, s.deps), { status: "refused", reason: "unknown", message: signInSentence("unknown") });
    assert.equal(s.calls.length, 0);
  });

  it("a database call that throws gives the unknown sentence", async () => {
    const s = standIn(() => {
      throw new Error("down");
    });
    assert.equal((await runSignIn("K7QM-3XPD-9RTA-W2FH", CONTEXT, s.deps)).status, "refused");
  });
});
