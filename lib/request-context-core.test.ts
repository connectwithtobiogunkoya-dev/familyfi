// Tests for reading where a request came from.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contextFromRequest } from "./request-context-core.ts";

describe("contextFromRequest", () => {
  it("takes the address from x-forwarded-for", () => {
    assert.equal(contextFromRequest(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), "production").address, "203.0.113.7");
  });

  it("never uses x-real-ip", () => {
    assert.equal(contextFromRequest(new Headers({ "x-real-ip": "203.0.113.7" }), "production").address, "unknown");
  });

  it("no header gives the unknown bucket", () => {
    assert.equal(contextFromRequest(new Headers(), "development").address, "unknown");
  });

  it("only NODE_ENV of exactly development counts as development", () => {
    assert.equal(contextFromRequest(new Headers(), "development").isDevelopment, true);
    for (const value of ["production", "test", "Development", "", undefined]) {
      assert.equal(contextFromRequest(new Headers(), value).isDevelopment, false, String(value));
    }
  });
});
