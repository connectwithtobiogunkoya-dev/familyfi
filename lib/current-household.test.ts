// A check that the retired household's id lives in exactly one place.
//
// Run with:  npm test
//
// The id of the retired Adeyemi household may appear in only one
// non-test file: lib/current-household.ts. Every page and action must get
// the household from getCurrentHouseholdId(). This test reads every source
// file under lib/ and app/ and fails if the id appears anywhere else.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const RETIRED_ID = "a0000000-0000-4000-8000-000000000001";
const PROJECT = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe("the retired household id", () => {
  const files = [...sourceFiles(join(PROJECT, "lib")), ...sourceFiles(join(PROJECT, "app"))];
  const holding = files
    .filter((path) => readFileSync(path, "utf8").includes(RETIRED_ID))
    .map((path) => relative(PROJECT, path).split(sep).join("/"));

  it("the search covers the pages and the libraries", () => {
    assert.ok(files.some((path) => path.endsWith(join("app", "app", "page.tsx"))));
    assert.ok(files.some((path) => path.endsWith(join("lib", "ledger.ts"))));
    assert.ok(files.some((path) => path.endsWith(join("lib", "moves.ts"))));
  });

  it("appears in exactly one non-test file: lib/current-household.ts", () => {
    assert.deepEqual(holding, ["lib/current-household.ts"]);
  });
});
