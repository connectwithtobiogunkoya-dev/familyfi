// Tests for where the visitor goes after an Add money request.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES } from "./errors.ts";
import { pathAfterAddMoney } from "./redirects.ts";

describe("pathAfterAddMoney", () => {
  it("done goes to /app?notice=added", () => {
    assert.equal(pathAfterAddMoney({ status: "done" }), "/app?notice=added");
  });

  it("replayed goes to /app?notice=replayed", () => {
    assert.equal(pathAfterAddMoney({ status: "replayed" }), "/app?notice=replayed");
  });

  for (const code of ERROR_CODES) {
    it(`refused with ${code} goes back to /app/add-money?error=${code}`, () => {
      assert.equal(pathAfterAddMoney({ status: "refused", code }), `/app/add-money?error=${code}`);
    });
  }

  it("every address it gives starts with /app and stays on this site", () => {
    const results = [
      { status: "done" as const },
      { status: "replayed" as const },
      ...ERROR_CODES.map((code) => ({ status: "refused" as const, code })),
    ];
    for (const result of results) {
      const path = pathAfterAddMoney(result);
      assert.ok(path.startsWith("/app"), path);
      assert.ok(!path.startsWith("//"), path);
      assert.ok(!path.includes("://"), path);
    }
  });
});
