// The Adeyemi family is retired: the app can no longer reach it.
//
// Run with:  npm test
//
// Its rows stay in the database (supabase/seed.sql made them), but no
// page or action may name its household any more. Every household now
// comes from the signed-in person's session. This test reads every source
// file under lib/ and app/ and fails if:
//   * the retired household id appears in any file that is not a test, or
//   * anything still imports getCurrentHouseholdId, or the file
//     lib/current-household.ts that held it.
//
// The id may still appear in supabase/seed.sql and in tests.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const RETIRED_ID = "a0000000-0000-4000-8000-000000000001";
const ROOT = new URL("../", import.meta.url);

function sourceFiles(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(new URL(folder, ROOT), { withFileTypes: true })) {
    const path = `${folder}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sourceFiles(`${path}/`));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

const FILES = [...sourceFiles("lib/"), ...sourceFiles("app/")].map((path) => ({
  path,
  source: readFileSync(new URL(path, ROOT), "utf8"),
}));

const isTest = (path: string) => /\.test\.(ts|tsx)$/.test(path);

describe("the retired Adeyemi household", () => {
  it("there are source files to check", () => {
    assert.ok(FILES.length > 40);
    assert.ok(FILES.some((file) => file.path === "app/app/page.tsx"));
  });

  it("its id appears in no non-test source file under lib/ or app/", () => {
    const holding = FILES.filter((file) => !isTest(file.path) && file.source.includes(RETIRED_ID)).map((file) => file.path);
    assert.deepEqual(holding, []);
  });

  it("nothing imports getCurrentHouseholdId or lib/current-household", () => {
    // An import of the name, or of the file by any path, in any file but
    // this one (which holds a sample import, below, to prove the check).
    const importing = FILES.filter(
      (file) =>
        file.path !== "lib/retired-household.test.ts" &&
        (/import\s[^;]*\bgetCurrentHouseholdId\b/.test(file.source) ||
        /(from|import)\s*\(?\s*["'][^"']*current-household(\.ts)?["']/.test(file.source) ||
        /require\(\s*["'][^"']*current-household/.test(file.source)),
    ).map((file) => file.path);
    assert.deepEqual(importing, []);
  });

  it("the import check would catch an import", () => {
    const sample = 'import { getCurrentHouseholdId } from "../../lib/current-household";';
    assert.ok(/import\s[^;]*\bgetCurrentHouseholdId\b/.test(sample));
    assert.ok(/(from|import)\s*\(?\s*["'][^"']*current-household(\.ts)?["']/.test(sample));
  });

  it("no non-test file even mentions getCurrentHouseholdId", () => {
    const mentioning = FILES.filter((file) => !isTest(file.path) && /getCurrentHouseholdId/.test(file.source)).map((file) => file.path);
    assert.deepEqual(mentioning, []);
  });

  it("lib/current-household.ts is gone", () => {
    assert.ok(!FILES.some((file) => file.path === "lib/current-household.ts"));
  });
});
