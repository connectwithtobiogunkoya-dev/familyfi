// Tests for the sign-out button's server action.
//
// Run with:  npm test
//
// A stand-in replaces the database. Nothing real is ended.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runSignOutAction } from "./sign-out-action-core.ts";
import { runSignOut } from "./sign-out-core.ts";
import { generateSessionToken, sessionTokenFingerprint } from "./session-token.ts";

describe("runSignOutAction", () => {
  it("the database ends the session: delete the cookie and go to /", async () => {
    const token = generateSessionToken();
    const ended: string[] = [];
    const outcome = await runSignOutAction({
      endCurrentSession: () =>
        runSignOut(token, async (hash) => {
          ended.push(hash);
          return true;
        }),
    });
    assert.deepEqual(outcome, { deleteCookie: true, redirectTo: "/" });
    assert.deepEqual(ended, [sessionTokenFingerprint(token)]);
  });

  it("the database call fails: still delete the cookie and go to /", async () => {
    const outcome = await runSignOutAction({
      endCurrentSession: () =>
        runSignOut(generateSessionToken(), async () => {
          throw new Error("down");
        }),
    });
    assert.deepEqual(outcome, { deleteCookie: true, redirectTo: "/" });
  });

  it("endCurrentSession itself throws: still delete the cookie and go to /", async () => {
    const outcome = await runSignOutAction({
      endCurrentSession: async () => {
        throw new Error("no cookies here");
      },
    });
    assert.deepEqual(outcome, { deleteCookie: true, redirectTo: "/" });
  });

  it("no proper cookie: no database call, and the cookie still goes", async () => {
    let called = false;
    const outcome = await runSignOutAction({
      endCurrentSession: () =>
        runSignOut(undefined, async () => {
          called = true;
          return true;
        }),
    });
    assert.deepEqual(outcome, { deleteCookie: true, redirectTo: "/" });
    assert.equal(called, false);
  });

  it("the outcome holds no token", async () => {
    const token = generateSessionToken();
    const outcome = await runSignOutAction({ endCurrentSession: () => runSignOut(token, async () => true) });
    const text = JSON.stringify(outcome);
    assert.ok(!text.includes(token));
    assert.ok(!text.includes(sessionTokenFingerprint(token)));
  });
});
