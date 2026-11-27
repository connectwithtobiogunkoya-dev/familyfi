// /welcome and /app/profile show one sentence when something cannot be
// read, which reads correctly for an owner and a partner alike. Sign-up
// keeps its own sentence.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { signUpRefusalSentence } from "./auth-limits.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NEW_SENTENCE = "We could not load this right now. Please try again.";

describe("the load-failed sentence on /welcome and /app/profile", () => {
  for (const path of ["../app/welcome/page.tsx", "../app/app/profile/page.tsx"]) {
    it(`${path} shows the new sentence, and not sign-up's`, () => {
      const source = read(path);
      assert.ok(source.includes(`const LOAD_FAILED_SENTENCE = "${NEW_SENTENCE}";`));
      assert.match(source, /\{LOAD_FAILED_SENTENCE\}/);
      assert.ok(!/signUpRefusalSentence/.test(source));
      assert.ok(!source.includes("We could not create your household"));
    });
  }

  it("/app/profile uses it in both places: no profile, and no access code", () => {
    assert.equal(read("../app/app/profile/page.tsx").match(/\{LOAD_FAILED_SENTENCE\}/g)?.length, 2);
  });

  it("sign-up's own unknown sentence is unchanged", () => {
    assert.equal(signUpRefusalSentence("unknown"), "We could not create your household right now. Please try again later.");
  });
});
