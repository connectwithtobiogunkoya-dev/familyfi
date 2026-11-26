// Tests for session tokens.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { generateSessionToken, looksLikeSessionToken, sessionTokenFingerprint } from "./session-token.ts";

describe("generateSessionToken", () => {
  it("is 43 characters long", () => {
    assert.equal(generateSessionToken().length, 43);
  });

  it("uses only base64url characters", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(generateSessionToken(), /^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("is the writing of exactly 32 bytes", () => {
    assert.equal(Buffer.from(generateSessionToken(), "base64url").length, 32);
  });

  it("1,000 tokens are all different", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      tokens.add(generateSessionToken());
    }
    assert.equal(tokens.size, 1000);
  });

  it("a freshly made token looks like a token", () => {
    assert.equal(looksLikeSessionToken(generateSessionToken()), true);
  });
});

describe("sessionTokenFingerprint", () => {
  it("is SHA-256 of the token's text, as 64 lowercase hex characters", () => {
    const token = generateSessionToken();
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    assert.equal(sessionTokenFingerprint(token), expected);
    assert.match(sessionTokenFingerprint(token), /^[0-9a-f]{64}$/);
  });

  it("is always 64 lowercase hex characters, whatever the token looks like", () => {
    for (const token of ["", "a", "A".repeat(43), "ÄÖÜ ✓", "x".repeat(10000)]) {
      assert.match(sessionTokenFingerprint(token), /^[0-9a-f]{64}$/);
    }
  });

  it("the same token always gives the same fingerprint", () => {
    const token = generateSessionToken();
    assert.equal(sessionTokenFingerprint(token), sessionTokenFingerprint(token));
  });

  it("different tokens give different fingerprints", () => {
    assert.notEqual(sessionTokenFingerprint(generateSessionToken()), sessionTokenFingerprint(generateSessionToken()));
  });

  it("the fingerprint does not contain the token", () => {
    const token = generateSessionToken();
    assert.ok(!sessionTokenFingerprint(token).includes(token));
  });
});

describe("looksLikeSessionToken: malformed tokens are refused without throwing", () => {
  const good = generateSessionToken();

  const bad: Array<[label: string, value: unknown]> = [
    ["empty", ""],
    ["too short", good.slice(0, 42)],
    ["too long", `${good}A`],
    ["a plus sign (base64, not base64url)", `+${good.slice(1)}`],
    ["a slash", `/${good.slice(1)}`],
    ["padding", `${good.slice(0, 42)}=`],
    ["a space", ` ${good.slice(1)}`],
    ["a line break at the end", `${good.slice(0, 42)}\n`],
    ["a non-ASCII letter", `é${good.slice(1)}`],
    ["not the exact writing of 32 bytes", `${good.slice(0, 42)}B`],
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345],
    ["a list", [good]],
  ];

  for (const [label, value] of bad) {
    it(`${label} is refused`, () => {
      assert.doesNotThrow(() => looksLikeSessionToken(value));
      assert.equal(looksLikeSessionToken(value), false);
    });
  }
});
