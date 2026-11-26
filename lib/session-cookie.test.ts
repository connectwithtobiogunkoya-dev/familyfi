// Tests for the session cookie's name and settings.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_COOKIE_NAME, deleteSessionCookieOptions, sessionCookieOptions } from "./session-cookie.ts";

describe("the session cookie", () => {
  it("is called familyfi_session", () => {
    assert.equal(SESSION_COOKIE_NAME, "familyfi_session");
  });

  it("on the live site: HttpOnly, SameSite lax, Path /, 180 days, Secure", () => {
    assert.deepEqual(sessionCookieOptions(true), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 180 * 24 * 60 * 60,
      secure: true,
    });
  });

  it("on a developer's computer: the same, but not Secure (plain http://localhost)", () => {
    assert.equal(sessionCookieOptions(false).secure, false);
    assert.equal(sessionCookieOptions(false).httpOnly, true);
  });

  it("180 days is 15,552,000 seconds", () => {
    assert.equal(sessionCookieOptions(true).maxAge, 15552000);
  });

  it("only exactly true counts as the live site", () => {
    assert.equal(sessionCookieOptions("yes" as unknown as boolean).secure, false);
  });

  it("deleting uses the same cookie with no time left", () => {
    assert.deepEqual(deleteSessionCookieOptions(true), { ...sessionCookieOptions(true), maxAge: 0 });
    assert.deepEqual(deleteSessionCookieOptions(false), { ...sessionCookieOptions(false), maxAge: 0 });
  });
});
