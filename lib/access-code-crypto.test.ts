// Tests for locking and unlocking access codes.
//
// Run with:  npm test
//
// The keys here are made fresh for each test run. They are never real keys.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { generateAccessCode } from "./access-code.ts";
import { decryptAccessCode, encryptAccessCode } from "./access-code-crypto.ts";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const CODE = "K7QM-3XPD-9RTA-W2FH";

const BASE64URL_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("encryptAccessCode and decryptAccessCode", () => {
  it("100 generated codes come back exactly as they went in", () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateAccessCode();
      assert.equal(decryptAccessCode(encryptAccessCode(code, KEY), KEY), code);
    }
  });

  it("the locked copy is three base64url parts joined by full stops", () => {
    const parts = encryptAccessCode(CODE, KEY).split(".");
    assert.equal(parts.length, 3);
    for (const part of parts) {
      assert.match(part, /^[A-Za-z0-9_-]+$/);
    }
    assert.equal(parts[0].length, 16);
    assert.equal(parts[2].length, 22);
  });

  it("the same code locked twice gives two different texts", () => {
    assert.notEqual(encryptAccessCode(CODE, KEY), encryptAccessCode(CODE, KEY));
  });

  it("the locked copy does not contain the code", () => {
    const locked = encryptAccessCode(CODE, KEY);
    assert.ok(!locked.includes(CODE));
    assert.ok(!locked.includes(CODE.replace(/-/g, "")));
  });

  it("a change to any one character anywhere is refused", () => {
    const locked = encryptAccessCode(CODE, KEY);
    for (let position = 0; position < locked.length; position += 1) {
      const original = locked[position];
      // Swap in a different character: another base64url character, or,
      // where there was a full stop, a letter.
      const replacement =
        original === "."
          ? "A"
          : BASE64URL_CHARACTERS[(BASE64URL_CHARACTERS.indexOf(original) + 1) % BASE64URL_CHARACTERS.length];
      const changed = locked.slice(0, position) + replacement + locked.slice(position + 1);
      assert.throws(() => decryptAccessCode(changed, KEY), /could not be unlocked/, `position ${position}`);
    }
  });

  it("a change to the last character of a part, which base64url could hide, is still refused", () => {
    const locked = encryptAccessCode(CODE, KEY);
    const parts = locked.split(".");
    for (let p = 0; p < 3; p += 1) {
      for (const replacement of BASE64URL_CHARACTERS) {
        const part = parts[p];
        if (replacement === part[part.length - 1]) {
          continue;
        }
        const changedParts = [...parts];
        changedParts[p] = part.slice(0, -1) + replacement;
        assert.throws(() => decryptAccessCode(changedParts.join("."), KEY), /could not be unlocked/);
      }
    }
  });

  it("the wrong key is refused", () => {
    assert.throws(() => decryptAccessCode(encryptAccessCode(CODE, KEY), OTHER_KEY), /could not be unlocked/);
  });

  const malformed: Array<[label: string, value: unknown]> = [
    ["an empty text", ""],
    ["one part only", "abc"],
    ["two parts", "a.b"],
    ["four parts", "a.b.c.d"],
    ["an empty middle part", "AAAAAAAAAAAAAAAA..AAAAAAAAAAAAAAAAAAAAAA"],
    ["padding characters", "AAAAAAAAAAAAAAAA.AA==.AAAAAAAAAAAAAAAAAAAAAA"],
    ["characters that are not base64url", "AAAAAAAAAAAAAAAA.A+/A.AAAAAAAAAAAAAAAAAAAAAA"],
    ["a very long text", "A".repeat(5000)],
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345],
    ["a buffer", Buffer.from("abc")],
  ];

  for (const [label, value] of malformed) {
    it(`${label} is refused`, () => {
      assert.throws(() => decryptAccessCode(value as string, KEY), /could not be unlocked/);
    });
  }

  it("a locked copy cut short is refused", () => {
    const locked = encryptAccessCode(CODE, KEY);
    for (const length of [0, 1, 10, 16, 17, 30, locked.length - 23, locked.length - 1]) {
      assert.throws(() => decryptAccessCode(locked.slice(0, length), KEY), /could not be unlocked/, `length ${length}`);
    }
  });

  it("an empty code cannot be locked", () => {
    assert.throws(() => encryptAccessCode("", KEY), /could not be locked/);
  });
});

describe("keys", () => {
  const badKeys: Array<[label: string, key: unknown]> = [
    ["31 bytes", randomBytes(31)],
    ["33 bytes", randomBytes(33)],
    ["16 bytes", randomBytes(16)],
    ["an empty buffer", Buffer.alloc(0)],
    ["64 hexadecimal characters as text (not yet turned into bytes)", "a".repeat(64)],
    ["undefined", undefined],
  ];

  for (const [label, key] of badKeys) {
    it(`a key of ${label} is refused for locking and unlocking`, () => {
      assert.throws(() => encryptAccessCode(CODE, key as Buffer), /must be exactly 32 bytes/);
      assert.throws(() => decryptAccessCode("x", key as Buffer), /must be exactly 32 bytes/);
    });
  }
});

describe("error messages never contain the code, the key or the locked text", () => {
  function messageOf(action: () => unknown): string {
    try {
      action();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "";
  }

  it("for a wrong key, a changed text and a bad key", () => {
    const locked = encryptAccessCode(CODE, KEY);
    const messages = [
      messageOf(() => decryptAccessCode(locked, OTHER_KEY)),
      messageOf(() => decryptAccessCode(`${locked}A`, KEY)),
      messageOf(() => decryptAccessCode(locked, randomBytes(31))),
      messageOf(() => encryptAccessCode(CODE, randomBytes(31))),
    ];
    for (const message of messages) {
      assert.ok(message.length > 0);
      assert.ok(!message.includes(CODE));
      assert.ok(!message.includes(CODE.replace(/-/g, "")));
      assert.ok(!message.includes(KEY.toString("hex")));
      assert.ok(!message.includes(KEY.toString("base64")));
      assert.ok(!message.includes(locked));
      for (const part of locked.split(".")) {
        assert.ok(!message.includes(part));
      }
    }
  });
});
