// Tests for recognising a visitor.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { UNKNOWN_VISITOR, visitorAddress, visitorFingerprint } from "./visitor.ts";

// Request headers, as a server would see them.
function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("visitorAddress", () => {
  it("uses the address in x-forwarded-for", () => {
    assert.equal(visitorAddress(headers({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  });

  it("uses the leftmost entry when there is a list", () => {
    assert.equal(visitorAddress(headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.2, 192.0.2.9" })), "203.0.113.7");
  });

  it("trims spaces around the leftmost entry", () => {
    assert.equal(visitorAddress(headers({ "x-forwarded-for": "   203.0.113.7   , 198.51.100.2" })), "203.0.113.7");
  });

  it("accepts an IPv6 address, in small letters", () => {
    assert.equal(visitorAddress(headers({ "x-forwarded-for": "2001:DB8::1, 198.51.100.2" })), "2001:db8::1");
  });

  it("accepts an IPv6 address with an IPv4 part", () => {
    assert.equal(visitorAddress(headers({ "x-forwarded-for": "::ffff:203.0.113.7" })), "::ffff:203.0.113.7");
  });

  it("never uses x-real-ip, even when x-forwarded-for is missing", () => {
    assert.equal(visitorAddress(headers({ "x-real-ip": "203.0.113.7" })), UNKNOWN_VISITOR);
  });

  it("never uses x-real-ip when both are there", () => {
    assert.equal(
      visitorAddress(headers({ "x-forwarded-for": "198.51.100.2", "x-real-ip": "203.0.113.7" })),
      "198.51.100.2",
    );
  });

  it("a missing header gives unknown", () => {
    assert.equal(visitorAddress(headers({})), UNKNOWN_VISITOR);
    assert.equal(UNKNOWN_VISITOR, "unknown");
  });

  const garbage: Array<[label: string, value: string]> = [
    ["an empty header", ""],
    ["only spaces", "   "],
    ["a word", "localhost"],
    ["a leftmost entry that is a word", "unknown, 203.0.113.7"],
    ["an empty leftmost entry", ", 203.0.113.7"],
    ["an address with a port", "203.0.113.7:8080"],
    ["an IPv6 address in brackets", "[2001:db8::1]"],
    ["numbers out of range", "999.0.113.7"],
    ["a script", "<script>alert(1)</script>"],
    ["a very long header", "a".repeat(10000)],
    ["a line break", "203.0.113.7\nX-Other: 1"],
  ];

  for (const [label, value] of garbage) {
    it(`${label} gives unknown`, () => {
      const source = { get: (name: string) => (name === "x-forwarded-for" ? value : null) };
      assert.equal(visitorAddress(source), UNKNOWN_VISITOR);
    });
  }

  it("asks only for x-forwarded-for", () => {
    const asked: string[] = [];
    visitorAddress({
      get: (name) => {
        asked.push(name);
        return null;
      },
    });
    assert.deepEqual(asked, ["x-forwarded-for"]);
  });
});

describe("visitorFingerprint", () => {
  const key = "a-test-key-for-these-tests-only";

  it("is HMAC-SHA256 of the address with the key, as 64 lowercase hex characters", () => {
    const expected = createHmac("sha256", key).update("203.0.113.7", "utf8").digest("hex");
    assert.equal(visitorFingerprint("203.0.113.7", key), expected);
    assert.match(visitorFingerprint("203.0.113.7", key), /^[0-9a-f]{64}$/);
  });

  it("the same address and key always give the same fingerprint", () => {
    assert.equal(visitorFingerprint("203.0.113.7", key), visitorFingerprint("203.0.113.7", key));
  });

  it("a different key gives a different fingerprint", () => {
    assert.notEqual(visitorFingerprint("203.0.113.7", key), visitorFingerprint("203.0.113.7", `${key}-2`));
  });

  it("different addresses give different fingerprints", () => {
    assert.notEqual(visitorFingerprint("203.0.113.7", key), visitorFingerprint("203.0.113.8", key));
  });

  it("the unknown bucket also gets a fingerprint", () => {
    assert.match(visitorFingerprint(UNKNOWN_VISITOR, key), /^[0-9a-f]{64}$/);
  });

  it("an empty key throws", () => {
    assert.throws(() => visitorFingerprint("203.0.113.7", ""));
  });

  it("a key that is not text throws", () => {
    assert.throws(() => visitorFingerprint("203.0.113.7", undefined as unknown as string));
  });

  it("the address never appears in the fingerprint", () => {
    for (const address of ["203.0.113.7", "2001:db8::1", "1.1.1.1"]) {
      const fingerprint = visitorFingerprint(address, key);
      assert.ok(!fingerprint.includes(address));
      assert.ok(!fingerprint.includes(address.replace(/[.:]/g, "")));
    }
  });
});
