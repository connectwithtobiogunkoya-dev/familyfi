// Tests for reading the Slice 5 secrets.
//
// Run with:  npm test
//
// These use stand-in settings, made up for each test. The real server
// settings are never read or changed here.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { CURRENT_KEY_VERSION, readAccessCodeKeys, readVisitorKey } from "./secrets-core.ts";

const GOOD_HEX = randomBytes(32).toString("hex");

describe("CURRENT_KEY_VERSION", () => {
  it("is 1", () => {
    assert.equal(CURRENT_KEY_VERSION, 1);
  });
});

describe("readAccessCodeKeys", () => {
  it("a valid key gives a map with version 1 holding the 32 bytes", () => {
    const keys = readAccessCodeKeys({ ACCESS_CODE_ENCRYPTION_KEY: GOOD_HEX });
    assert.ok(keys !== null);
    assert.deepEqual([...keys.keys()], [1]);
    assert.equal(keys.get(1)?.length, 32);
    assert.equal(keys.get(1)?.toString("hex"), GOOD_HEX);
  });

  it("capital hexadecimal letters are accepted", () => {
    assert.ok(readAccessCodeKeys({ ACCESS_CODE_ENCRYPTION_KEY: GOOD_HEX.toUpperCase() }) !== null);
  });

  const bad: Array<[label: string, value: string | undefined]> = [
    ["missing", undefined],
    ["empty", ""],
    ["63 characters", GOOD_HEX.slice(0, 63)],
    ["65 characters", `${GOOD_HEX}0`],
    ["32 characters", GOOD_HEX.slice(0, 32)],
    ["not hexadecimal", `${GOOD_HEX.slice(0, 63)}g`],
    ["with a space at the end", `${GOOD_HEX.slice(0, 63)} `],
    ["with a line break at the end", `${GOOD_HEX}\n`],
    ["written in base64", randomBytes(32).toString("base64")],
  ];

  for (const [label, value] of bad) {
    it(`${label} gives null`, () => {
      assert.equal(readAccessCodeKeys({ ACCESS_CODE_ENCRYPTION_KEY: value }), null);
    });
  }

  it("reads only its own setting", () => {
    assert.equal(readAccessCodeKeys({ VISITOR_HASH_KEY: GOOD_HEX }), null);
  });
});

describe("readVisitorKey", () => {
  it("a valid key is given back as it is", () => {
    assert.equal(readVisitorKey({ VISITOR_HASH_KEY: GOOD_HEX }), GOOD_HEX);
  });

  const bad: Array<[label: string, value: string | undefined]> = [
    ["missing", undefined],
    ["empty", ""],
    ["63 characters", GOOD_HEX.slice(0, 63)],
    ["not hexadecimal", `${GOOD_HEX.slice(0, 63)}z`],
    ["with spaces around it", ` ${GOOD_HEX} `],
  ];

  for (const [label, value] of bad) {
    it(`${label} gives null`, () => {
      assert.equal(readVisitorKey({ VISITOR_HASH_KEY: value }), null);
    });
  }

  it("reads only its own setting", () => {
    assert.equal(readVisitorKey({ ACCESS_CODE_ENCRYPTION_KEY: GOOD_HEX }), null);
  });
});

describe("the null path never carries the value", () => {
  it("a bad setting gives exactly null, with nothing else attached", () => {
    const almostValid = `${GOOD_HEX.slice(0, 63)}x`;
    const keys = readAccessCodeKeys({ ACCESS_CODE_ENCRYPTION_KEY: almostValid });
    const visitor = readVisitorKey({ VISITOR_HASH_KEY: almostValid });
    assert.strictEqual(keys, null);
    assert.strictEqual(visitor, null);
    assert.equal(JSON.stringify({ keys, visitor }), '{"keys":null,"visitor":null}');
  });

  it("neither function throws for any stand-in value", () => {
    for (const value of [undefined, "", "x", "0".repeat(10000), GOOD_HEX]) {
      assert.doesNotThrow(() => readAccessCodeKeys({ ACCESS_CODE_ENCRYPTION_KEY: value }));
      assert.doesNotThrow(() => readVisitorKey({ VISITOR_HASH_KEY: value }));
    }
  });
});
