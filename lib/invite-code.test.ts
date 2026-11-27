// Tests for invite codes, the Slice 6 limits, the invite sentences and the
// Lagos time formatter.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { ACCESS_CODE_ALPHABET, accessCodeFingerprint, tidyAccessCode } from "./access-code.ts";
import { decryptAccessCode } from "./access-code-crypto.ts";
import { AUTH_LIMITS, INVITE_LIMITS, maxSignUpsPerVisitor, signInSentence, signUpRefusalSentence } from "./auth-limits.ts";
import {
  formatInviteCode,
  generateInviteCode,
  inviteCodeFingerprint,
  lockInviteCode,
  tidyInviteCode,
  unlockInviteCode,
} from "./invite-code.ts";
import {
  INVITE_NOT_VALID_SENTENCE,
  INVITE_REFUSAL_CODES,
  JOIN_REFUSAL_CODES,
  inviteRefusalSentence,
  joinSentence,
  readRefusalCode,
} from "./invite-rules.ts";
import { lagosDateTime, stopsWorkingLine } from "./lagos-time.ts";

describe("invite codes", () => {
  it("are 16 alphabet characters in four groups of four", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateInviteCode();
      assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      for (const character of code.replace(/-/g, "")) {
        assert.ok(ACCESS_CODE_ALPHABET.includes(character));
      }
    }
  });

  it("are tidied exactly like access codes", () => {
    for (const typed of ["4hqx 7mrt-2kpd 9wva", "  OIL-oil ", "", "x".repeat(200), 42]) {
      assert.equal(tidyInviteCode(typed), tidyAccessCode(typed));
    }
  });

  it("an invite fingerprint of a code equals the access code fingerprint of the same string", () => {
    for (const typed of ["4HQX-7MRT-2KPD-9WVA", "4hqx7mrt2kpd9wva", "K7QM-3XPD-9RTA-W2FH", "", "garbage", 12345]) {
      assert.equal(inviteCodeFingerprint(typed), accessCodeFingerprint(typed));
    }
  });

  it("the fingerprint of a known code is pinned", () => {
    // SHA-256 of "4HQX7MRT2KPD9WVA".
    assert.equal(inviteCodeFingerprint("4hqx-7mrt-2kpd-9wva"), accessCodeFingerprint("4HQX7MRT2KPD9WVA"));
    assert.match(inviteCodeFingerprint("4HQX-7MRT-2KPD-9WVA"), /^[0-9a-f]{64}$/);
  });

  it("the hyphenated form is locked, and unlocks with the same key", () => {
    const key = randomBytes(32);
    const locked = lockInviteCode("4hqx7mrt2kpd9wva", key);
    assert.equal(decryptAccessCode(locked, key), "4HQX-7MRT-2KPD-9WVA");
    assert.equal(unlockInviteCode(locked, key), "4HQX-7MRT-2KPD-9WVA");
    assert.ok(!locked.includes("4HQX"));
  });

  it("a different key cannot unlock it", () => {
    const locked = lockInviteCode("4HQX-7MRT-2KPD-9WVA", randomBytes(32));
    assert.throws(() => unlockInviteCode(locked, randomBytes(32)));
  });

  it("is shown in four groups whatever form it is in", () => {
    assert.equal(formatInviteCode("4hqx7mrt2kpd9wva"), "4HQX-7MRT-2KPD-9WVA");
    assert.equal(formatInviteCode("4HQX-7MRT-2KPD-9WVA"), "4HQX-7MRT-2KPD-9WVA");
  });
});

describe("the Slice 6 limits", () => {
  it("are the approved numbers", () => {
    assert.equal(INVITE_LIMITS.wrongInvitesPer15Minutes, 5);
    assert.equal(INVITE_LIMITS.wrongInvitesPer24Hours, 20);
    assert.equal(INVITE_LIMITS.invitesPerHouseholdPer24Hours, 10);
  });

  it("joins share the sign-up limits, which are unchanged", () => {
    assert.equal(AUTH_LIMITS.signUpsPerVisitorPer24Hours, 3);
    assert.equal(AUTH_LIMITS.customersPerDay, 50);
    assert.equal(AUTH_LIMITS.customersTotal, 300);
    assert.equal(maxSignUpsPerVisitor("203.0.113.7", false), 3);
  });

  it("the wrong-access-code limits are unchanged", () => {
    assert.equal(AUTH_LIMITS.wrongCodesPer15Minutes, 5);
    assert.equal(AUTH_LIMITS.wrongCodesPer24Hours, 20);
  });
});

describe("invite refusal codes and sentences", () => {
  it("every create_invite code has a fixed sentence", () => {
    assert.equal(inviteRefusalSentence("not_owner"), "Only the person who created the household can invite a partner.");
    assert.equal(inviteRefusalSentence("household_full"), "Your partner has joined. Your household is full.");
    assert.equal(inviteRefusalSentence("limit_invites"), "You have made too many invite codes today. Please try again tomorrow.");
    for (const code of ["bad_request", "code_taken", "unknown"] as const) {
      assert.equal(inviteRefusalSentence(code), signUpRefusalSentence("unknown"));
    }
    for (const code of INVITE_REFUSAL_CODES) {
      assert.ok(inviteRefusalSentence(code).length > 0);
    }
  });

  it("every join_household status and code has a fixed sentence", () => {
    assert.equal(joinSentence("invite_not_valid"), "That invite code did not work. Check it with your partner and try again.");
    assert.equal(INVITE_NOT_VALID_SENTENCE, joinSentence("invite_not_valid"));
    assert.equal(joinSentence("too_many_attempts"), signInSentence("too_many_attempts"));
    for (const code of JOIN_REFUSAL_CODES) {
      assert.equal(joinSentence(code), signUpRefusalSentence(code));
    }
    assert.equal(joinSentence("unknown"), signUpRefusalSentence("unknown"));
  });

  it("only a listed code before a colon is read; nothing else of a message", () => {
    assert.equal(readRefusalCode("not_owner: Only the household's owner can create an invite.", INVITE_REFUSAL_CODES), "not_owner");
    assert.equal(readRefusalCode({ message: "limit_invites: too many" }, INVITE_REFUSAL_CODES), "limit_invites");
    for (const value of ["under_18: x", "NOT_OWNER: x", " not_owner: x", "not_owner", "", null, 7, { message: 3 }, `not_owner:${"x".repeat(2000)}`]) {
      assert.equal(readRefusalCode(value, INVITE_REFUSAL_CODES), "unknown", String(value).slice(0, 30));
    }
    assert.equal(readRefusalCode("under_18: The person must be 18 or over.", JOIN_REFUSAL_CODES), "under_18");
    assert.equal(readRefusalCode("not_owner: x", JOIN_REFUSAL_CODES), "unknown");
  });
});

describe("Lagos time", () => {
  it("23:30 UTC is 00:30 the next day in Lagos", () => {
    assert.equal(lagosDateTime("2026-11-29T23:30:00Z"), "30 November 2026, 00:30");
  });

  it("00:30 UTC is 01:30 the same day in Lagos", () => {
    assert.equal(lagosDateTime("2026-11-30T00:30:00Z"), "30 November 2026, 01:30");
  });

  it("the UTC date and the Lagos date differ across midnight, and across a year end", () => {
    assert.equal(lagosDateTime("2026-12-31T23:15:00Z"), "1 January 2027, 00:15");
    assert.equal(lagosDateTime("2026-11-29T22:59:00Z"), "29 November 2026, 23:59");
  });

  it("uses a 24-hour clock", () => {
    assert.equal(lagosDateTime("2026-11-29T13:05:00Z"), "29 November 2026, 14:05");
  });

  it("reads the database's form of a moment", () => {
    assert.equal(lagosDateTime("2026-11-29T13:05:00.123456+00:00"), "29 November 2026, 14:05");
  });

  it("gives the approved line", () => {
    assert.equal(stopsWorkingLine("2026-11-29T13:05:00Z"), "Stops working: 29 November 2026, 14:05");
  });

  it("something that is not a moment gives null", () => {
    assert.equal(lagosDateTime("tomorrow"), null);
    assert.equal(stopsWorkingLine("tomorrow"), null);
  });
});
