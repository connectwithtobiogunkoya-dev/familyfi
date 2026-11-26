// Tests for the sign-up and sign-in limits, codes and sentences.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_LIMITS,
  SIGN_IN_STATUSES,
  SIGN_UP_REFUSAL_CODES,
  readSignInStatus,
  readSignUpRefusal,
  signInSentence,
  signUpRefusalSentence,
} from "./auth-limits.ts";

const SIGN_UP_SENTENCES = {
  bad_details: "Some details are not in the right form. Please check them and try again.",
  not_verified: "We could not verify these details. This is a simulated check.",
  under_18: "You must be 18 or over to sign up.",
  bad_request: "We could not create your household right now. Please try again.",
  limit_visitor: "Sign-up is not available right now. Please try again later.",
  limit_daily: "Sign-up is not available right now. Please try again later.",
  limit_total: "Sign-up is not available right now. Please try again later.",
  code_taken: "We could not create your household right now. Please try again.",
  numbers_exhausted: "We could not create your household right now. Please try again.",
  unknown: "We could not create your household right now. Please try again later.",
} as const;

const SIGN_IN_SENTENCES = {
  signed_in: "You are signed in.",
  wrong_code: "That access code did not work. Check it and try again.",
  too_many_attempts: "Too many attempts. Please wait 15 minutes and try again.",
  no_household: "We could not sign you in right now. Please try again later.",
  unknown: "We could not sign you in right now. Please try again later.",
} as const;

describe("AUTH_LIMITS: the approved numbers", () => {
  it("are exactly as approved in the Slice 5 plan", () => {
    assert.deepEqual(AUTH_LIMITS, {
      signUpsPerVisitorPer24Hours: 3,
      customersPerDay: 50,
      customersTotal: 300,
      wrongCodesPer15Minutes: 5,
      wrongCodesPer24Hours: 20,
      sessionIdleDays: 30,
      sessionAbsoluteDays: 180,
      sessionActivityUpdateMinutes: 60,
    });
  });

  it("the idle length is no longer than the absolute length, as the database requires", () => {
    assert.ok(AUTH_LIMITS.sessionIdleDays <= AUTH_LIMITS.sessionAbsoluteDays);
  });
});

describe("readSignUpRefusal: only codes on the list", () => {
  it("there are exactly these nine codes", () => {
    assert.deepEqual([...SIGN_UP_REFUSAL_CODES], [
      "bad_details",
      "not_verified",
      "under_18",
      "bad_request",
      "limit_visitor",
      "limit_daily",
      "limit_total",
      "code_taken",
      "numbers_exhausted",
    ]);
  });

  for (const code of SIGN_UP_REFUSAL_CODES) {
    it(`"${code}: ..." gives ${code}`, () => {
      assert.equal(readSignUpRefusal(`${code}: Some sentence from the database.`), code);
    });

    it(`an error object whose message starts "${code}:" gives ${code}`, () => {
      assert.equal(readSignUpRefusal({ code: "23514", message: `${code}: Something.` }), code);
    });
  }

  it("the real under_18 message from create_household is read", () => {
    assert.equal(readSignUpRefusal("under_18: The person must be 18 or over."), "under_18");
  });

  const unknownInputs: Array<[label: string, value: unknown]> = [
    ["a message with no colon", "under_18 The person must be 18 or over."],
    ["a code alone with no colon", "limit_visitor"],
    ["a code not on the list", "limit_weekly: Too many."],
    ["a code in capitals", "UNDER_18: The person must be 18 or over."],
    ["a space before the colon", "under_18 : The person must be 18 or over."],
    ["a space before the code", " under_18: The person must be 18 or over."],
    ["the code later in the message", "Error: under_18: nested"],
    ["a code with extra letters", "under_18x: Something."],
    ["an empty message", ""],
    ["a colon alone", ":"],
    ["a very long message", `under_18: ${"x".repeat(5000)}`],
    ["a Postgres error of another kind", "duplicate key value violates unique constraint \"customers_pkey\""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 18],
    ["an object without a message", { code: "P0001" }],
    ["an object whose message is not text", { message: 123 }],
    ["a list", ["under_18: x"]],
  ];

  for (const [label, value] of unknownInputs) {
    it(`${label} gives unknown`, () => {
      assert.equal(readSignUpRefusal(value), "unknown");
    });
  }

  it("never gives back any part of the message other than the code", () => {
    const message = "limit_total: secret detail 000123 for the log only";
    const result = readSignUpRefusal(message);
    assert.equal(result, "limit_total");
    assert.ok(!result.includes("secret") && !result.includes("000123"));
  });
});

describe("signUpRefusalSentence", () => {
  for (const [code, sentence] of Object.entries(SIGN_UP_SENTENCES)) {
    it(`${code} gives "${sentence}"`, () => {
      assert.equal(signUpRefusalSentence(code as keyof typeof SIGN_UP_SENTENCES), sentence);
    });
  }

  it("the three limits share one sentence, so a visitor cannot tell them apart", () => {
    const sentences = new Set(["limit_visitor", "limit_daily", "limit_total"].map((c) => signUpRefusalSentence(c as "limit_daily")));
    assert.equal(sentences.size, 1);
    assert.match([...sentences][0], /try again later/);
  });

  it("a code that is somehow not on the list gets the unknown sentence", () => {
    assert.equal(signUpRefusalSentence("<script>" as "unknown"), SIGN_UP_SENTENCES.unknown);
  });
});

describe("readSignInStatus", () => {
  for (const status of SIGN_IN_STATUSES) {
    it(`{"status": "${status}"} gives ${status}`, () => {
      assert.equal(readSignInStatus({ status }), status);
    });

    it(`"${status}" on its own gives ${status}`, () => {
      assert.equal(readSignInStatus(status), status);
    });
  }

  it("a signed_in result with its ids gives signed_in", () => {
    assert.equal(readSignInStatus({ status: "signed_in", customer_id: "c", household_id: "h" }), "signed_in");
  });

  const unknownInputs: Array<[label: string, value: unknown]> = [
    ["an unknown status", { status: "locked" }],
    ["a status in capitals", { status: "WRONG_CODE" }],
    ["a status with a space", { status: "wrong_code " }],
    ["no status", {}],
    ["a status that is not text", { status: 1 }],
    ["null", null],
    ["undefined", undefined],
    ["a list", [{ status: "signed_in" }]],
  ];

  for (const [label, value] of unknownInputs) {
    it(`${label} gives unknown`, () => {
      assert.equal(readSignInStatus(value), "unknown");
    });
  }
});

describe("signInSentence", () => {
  for (const [status, sentence] of Object.entries(SIGN_IN_SENTENCES)) {
    it(`${status} gives "${sentence}"`, () => {
      assert.equal(signInSentence(status as keyof typeof SIGN_IN_SENTENCES), sentence);
    });
  }
});

describe("every visitor sentence", () => {
  const all = [
    ...[...SIGN_UP_REFUSAL_CODES, "unknown" as const].map(signUpRefusalSentence),
    ...[...SIGN_IN_STATUSES, "unknown" as const].map(signInSentence),
  ];

  it("never contains either of the two words CLAUDE.md bans", () => {
    for (const sentence of all) {
      assert.ok(!/fake|demo/i.test(sentence), sentence);
    }
  });

  it("never contains three or more digits in a row, so it cannot hold a typed number", () => {
    for (const sentence of all) {
      assert.ok(!/[0-9]{3,}/.test(sentence), sentence);
    }
  });

  it("never contains a technical word from the database", () => {
    for (const sentence of all) {
      assert.ok(!/limit_|_|sql|postgres|constraint|error/i.test(sentence), sentence);
    }
  });
});
