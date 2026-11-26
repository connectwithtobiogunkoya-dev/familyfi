// Tests for signing out.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateSessionToken, sessionTokenFingerprint } from "./session-token.ts";
import { runSignOut } from "./sign-out-core.ts";

describe("runSignOut", () => {
  it("ends the session by its fingerprint and says to delete the cookie", async () => {
    const token = generateSessionToken();
    const asked: string[] = [];
    const result = await runSignOut(token, async (hash) => {
      asked.push(hash);
      return true;
    });
    assert.deepEqual(result, { deleteCookie: true, sessionEnded: true });
    assert.deepEqual(asked, [sessionTokenFingerprint(token)]);
  });

  it("still says to delete the cookie when the database call fails", async () => {
    const result = await runSignOut(generateSessionToken(), async () => {
      throw new Error("down");
    });
    assert.deepEqual(result, { deleteCookie: true, sessionEnded: false });
  });

  it("still says to delete the cookie when the session had already ended", async () => {
    assert.deepEqual(await runSignOut(generateSessionToken(), async () => false), { deleteCookie: true, sessionEnded: false });
  });

  it("a missing or malformed cookie: no database call, and the cookie still goes", async () => {
    for (const value of [undefined, "", "abc", 42]) {
      let called = false;
      const result = await runSignOut(value, async () => {
        called = true;
        return true;
      });
      assert.deepEqual(result, { deleteCookie: true, sessionEnded: false });
      assert.equal(called, false);
    }
  });
});
