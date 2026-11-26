// Tests for the confirmation notices on /app.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { errorSentence } from "./errors.ts";
import { NOTICE_CODES, noticeSentence, readNotice } from "./notices.ts";

describe("the fixed notices", () => {
  it("there are exactly three: added, moved and replayed", () => {
    assert.deepEqual([...NOTICE_CODES], ["added", "moved", "replayed"]);
  });

  it("added gives \"Money added to your wallet.\"", () => {
    assert.equal(noticeSentence("added"), "Money added to your wallet.");
  });

  it("moved gives \"Money moved.\"", () => {
    assert.equal(noticeSentence("moved"), "Money moved.");
  });

  it("replayed gives the same sentence as the replayed error code", () => {
    assert.equal(noticeSentence("replayed"), errorSentence("replayed"));
    assert.equal(noticeSentence("replayed"), "That was already done. Nothing moved a second time.");
  });
});

describe("readNotice: a code from the address bar", () => {
  it("\"added\" is accepted", () => {
    assert.equal(readNotice("added"), "Money added to your wallet.");
  });

  it("\"moved\" is accepted", () => {
    assert.equal(readNotice("moved"), "Money moved.");
  });

  it("\"replayed\" is accepted", () => {
    assert.equal(readNotice("replayed"), "That was already done. Nothing moved a second time.");
  });

  const madeUp: Array<[label: string, value: unknown]> = [
    ["a script tag", "<script>"],
    ["a script that runs code", "<script>alert(1)</script>"],
    ["an empty string", ""],
    ["a made-up word", "banana"],
    ["an error code instead of a notice", "not_enough"],
    ["a real code in capitals", "ADDED"],
    ["moved in capitals", "MOVED"],
    ["moved with a space after it", "moved "],
    ["moved with a line break after it", "moved\n"],
    ["moved with extra text", "moved<script>"],
    ["a near miss: move", "move"],
    ["a near miss: moved.", "moved."],
    ["a list containing moved", ["moved"]],
    ["a real code with a space after it", "added "],
    ["a real code with a line break after it", "added\n"],
    ["a real code with extra text", "added<script>"],
    ["two codes joined", "added,replayed"],
    ["very long text (100,000 characters)", "a".repeat(100000)],
    ["a real code repeated many times", "added".repeat(1000)],
    ["a list containing a real code", ["added"]],
    ["a list of two real codes", ["added", "replayed"]],
    ["an empty list", []],
    ["undefined (no notice in the address)", undefined],
    ["null", null],
    ["a number", 1],
    ["an object", { notice: "added" }],
    ["a built-in word: constructor", "constructor"],
    ["a built-in word: __proto__", "__proto__"],
  ];

  for (const [label, value] of madeUp) {
    it(`${label} gives nothing`, () => {
      assert.equal(readNotice(value), null);
    });
  }
});
