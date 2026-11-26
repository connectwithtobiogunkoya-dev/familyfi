// Tests for where the visitor goes after an Add money or Move money request.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES } from "./errors.ts";
import { pathAfterAddMoney, pathAfterMoveMoney } from "./redirects.ts";

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

describe("pathAfterMoveMoney", () => {
  it("done goes to /app?notice=moved", () => {
    assert.equal(pathAfterMoveMoney({ status: "done" }), "/app?notice=moved");
  });

  it("replayed goes to /app?notice=replayed", () => {
    assert.equal(pathAfterMoveMoney({ status: "replayed" }), "/app?notice=replayed");
  });

  for (const code of ERROR_CODES) {
    it(`refused with ${code} goes back to /app/move-money?error=${code}`, () => {
      assert.equal(pathAfterMoveMoney({ status: "refused", code }), `/app/move-money?error=${code}`);
    });
  }

  it("every address it gives starts with /app and stays on this site", () => {
    const results = [
      { status: "done" as const },
      { status: "replayed" as const },
      ...ERROR_CODES.map((code) => ({ status: "refused" as const, code })),
    ];
    for (const result of results) {
      const path = pathAfterMoveMoney(result);
      assert.ok(path.startsWith("/app"), path);
      assert.ok(!path.startsWith("//"), path);
      assert.ok(!path.includes("://"), path);
    }
  });
});

describe("every error code is covered", () => {
  it("bad_accounts is one of the codes both functions are tested with", () => {
    assert.ok((ERROR_CODES as readonly string[]).includes("bad_accounts"));
    assert.equal(pathAfterAddMoney({ status: "refused", code: "bad_accounts" }), "/app/add-money?error=bad_accounts");
    assert.equal(pathAfterMoveMoney({ status: "refused", code: "bad_accounts" }), "/app/move-money?error=bad_accounts");
  });
});
