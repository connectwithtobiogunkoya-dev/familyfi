// Tests for access codes.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  ACCESS_CODE_ALPHABET,
  accessCodeFingerprint,
  formatAccessCode,
  generateAccessCode,
  looksLikeAccessCode,
  tidyAccessCode,
} from "./access-code.ts";

// Worked out separately here, not with the code under test.
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("generateAccessCode", () => {
  it("is four groups of four, joined by hyphens", () => {
    assert.match(generateAccessCode(), /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("uses only the Crockford alphabet (no I, L, O or U)", () => {
    for (let i = 0; i < 200; i += 1) {
      for (const character of generateAccessCode().replace(/-/g, "")) {
        assert.ok(ACCESS_CODE_ALPHABET.includes(character), `unexpected character ${character}`);
      }
    }
    for (const letter of ["I", "L", "O", "U"]) {
      assert.ok(!ACCESS_CODE_ALPHABET.includes(letter));
    }
  });

  it("the alphabet has exactly 32 different characters", () => {
    assert.equal(ACCESS_CODE_ALPHABET.length, 32);
    assert.equal(new Set(ACCESS_CODE_ALPHABET).size, 32);
  });

  it("1,000 codes are all different", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      codes.add(generateAccessCode());
    }
    assert.equal(codes.size, 1000);
  });

  it("asks for exactly 10 random bytes (80 bits)", () => {
    let asked = 0;
    generateAccessCode((size) => {
      asked = size;
      return new Uint8Array(size);
    });
    assert.equal(asked, 10);
  });

  it("uses exactly 5 bits per character: all-zero bytes give all 0s, all-one bytes give all Zs", () => {
    assert.equal(generateAccessCode((size) => new Uint8Array(size)), "0000-0000-0000-0000");
    assert.equal(generateAccessCode((size) => new Uint8Array(size).fill(255)), "ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  });

  it("reads the bits in order: a known set of bytes gives a known code", () => {
    // 0x00 0x44 0x32 0x14 0xC7 repeated: the 40 bits split into the
    // 5-bit values 0,1,2,3,4,5,6,7, which are the characters 0 to 7.
    const pattern = [0x00, 0x44, 0x32, 0x14, 0xc7];
    const code = generateAccessCode(() => Uint8Array.from([...pattern, ...pattern]));
    assert.equal(code, "0123-4567-0123-4567");
  });

  it("refuses a random source that gives the wrong number of bytes", () => {
    assert.throws(() => generateAccessCode(() => new Uint8Array(9)));
  });
});

describe("formatAccessCode", () => {
  it("groups 16 characters as four groups of four", () => {
    assert.equal(formatAccessCode("K7QM3XPD9RTAW2FH"), "K7QM-3XPD-9RTA-W2FH");
  });
});

describe("tidyAccessCode", () => {
  const cases: Array<[label: string, typed: string, tidied: string]> = [
    ["small letters", "k7qm-3xpd-9rta-w2fh", "K7QM3XPD9RTAW2FH"],
    ["spaces instead of hyphens", "K7QM 3XPD 9RTA W2FH", "K7QM3XPD9RTAW2FH"],
    ["no separators", "K7QM3XPD9RTAW2FH", "K7QM3XPD9RTAW2FH"],
    ["spaces at the ends and a tab", "  K7QM-3XPD\t9RTA-W2FH  ", "K7QM3XPD9RTAW2FH"],
    ["O read as 0", "OOOO-0000-oooo-0000", "0000000000000000"],
    ["I and L read as 1", "IIII-LLLL-iiii-llll", "1111111111111111"],
    ["U is kept as U (and then is not a code)", "UUUU", "UUUU"],
  ];

  for (const [label, typed, tidied] of cases) {
    it(`${label}: "${typed}" becomes "${tidied}"`, () => {
      assert.equal(tidyAccessCode(typed), tidied);
    });
  }

  it("cuts typed text to 64 characters before tidying", () => {
    // 64 characters of "A-", then more: only the first 64 are read, which
    // after removing hyphens leaves 32 As.
    const typed = "A-".repeat(32) + "B".repeat(1000);
    assert.equal(tidyAccessCode(typed), "A".repeat(32));
  });

  it("a very long paste is handled quickly and stays short", () => {
    assert.equal(tidyAccessCode("Z".repeat(1_000_000)).length, 64);
  });

  it("anything that is not text becomes an empty string", () => {
    for (const value of [null, undefined, 12345, ["K7QM3XPD9RTAW2FH"], {}]) {
      assert.equal(tidyAccessCode(value), "");
    }
  });
});

describe("looksLikeAccessCode (for the form only)", () => {
  it("a generated code looks like a code", () => {
    assert.equal(looksLikeAccessCode(generateAccessCode()), true);
  });

  it("a code typed in small letters with spaces looks like a code", () => {
    assert.equal(looksLikeAccessCode("k7qm 3xpd 9rta w2fh"), true);
  });

  const notCodes: Array<[label: string, typed: unknown]> = [
    ["too short", "K7QM-3XPD-9RTA"],
    ["too long", "K7QM-3XPD-9RTA-W2FH-A"],
    ["a U, which is not in the alphabet", "UUUU-UUUU-UUUU-UUUU"],
    ["punctuation", "K7QM.3XPD.9RTA.W2FH"],
    ["empty", ""],
    ["not text", 42],
  ];

  for (const [label, typed] of notCodes) {
    it(`${label} does not look like a code`, () => {
      assert.equal(looksLikeAccessCode(typed), false);
    });
  }
});

describe("accessCodeFingerprint", () => {
  it("is SHA-256 of the tidied code, as 64 lowercase hex characters", () => {
    assert.equal(accessCodeFingerprint("K7QM-3XPD-9RTA-W2FH"), sha256("K7QM3XPD9RTAW2FH"));
    assert.match(accessCodeFingerprint("K7QM-3XPD-9RTA-W2FH"), /^[0-9a-f]{64}$/);
  });

  it("the same code typed differently gives the same fingerprint", () => {
    const fingerprint = accessCodeFingerprint("K7QM-3XPD-9RTA-W2FH");
    assert.equal(accessCodeFingerprint("k7qm 3xpd 9rta w2fh"), fingerprint);
    assert.equal(accessCodeFingerprint("K7QM3XPD9RTAW2FH"), fingerprint);
  });

  it("O, I and L typed by mistake give the same fingerprint as 0 and 1", () => {
    assert.equal(accessCodeFingerprint("OIL0-0000-0000-0000"), accessCodeFingerprint("0110-0000-0000-0000"));
  });

  it("different codes give different fingerprints", () => {
    assert.notEqual(accessCodeFingerprint("K7QM-3XPD-9RTA-W2FH"), accessCodeFingerprint("K7QM-3XPD-9RTA-W2FG"));
  });

  it("something that is not a proper code still gets a fingerprint, so a wrong guess can be counted", () => {
    for (const typed of ["", "hello", "UUUU", "A".repeat(500), "K7QM-3XPD"]) {
      const fingerprint = accessCodeFingerprint(typed);
      assert.match(fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(fingerprint, sha256(tidyAccessCode(typed)));
    }
  });

  it("anything that is not text still gets a fingerprint (of the empty string)", () => {
    assert.equal(accessCodeFingerprint(undefined), sha256(""));
  });
});
