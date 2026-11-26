// Tests for the profile screen's display values, and the profile page's
// source files.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ProfileAnswer } from "./auth-db-core.ts";
import { accountKindLabel, lagosDisplayDate, maskedNumber, profileDisplay, roleLabel } from "./profile-core.ts";

const PROFILE: ProfileAnswer = {
  fullName: "Ada Okafor",
  role: "wife",
  phone: "00012345678",
  memberRole: "owner",
  householdName: "Okafor household",
  verificationStatus: "verified",
  verificationMethod: "simulated",
  verifiedAt: "2026-11-26T23:30:00+00:00",
  ninLast3: "222",
  bvnLast3: "444",
  accounts: [
    { name: "Family Wallet", kind: "wallet", accountNumber: "0001234567" },
    { name: "Rent", kind: "pot", accountNumber: null },
  ],
};

describe("maskedNumber", () => {
  it("shows 8 bullets then the last 3 digits", () => {
    assert.equal(maskedNumber("123"), "••••••••123");
    assert.equal(maskedNumber("123").length, 11);
  });

  it("keeps leading zeros", () => {
    assert.equal(maskedNumber("007"), `${"•".repeat(8)}007`);
  });

  for (const value of ["12", "1234", "00011112222", "12a", "", 123, null, undefined]) {
    it(`${JSON.stringify(value) ?? "undefined"} is not 3 digits: 11 bullets and no digits`, () => {
      const shown = maskedNumber(value);
      assert.equal(shown, "•".repeat(11));
      assert.ok(!/[0-9]/.test(shown));
    });
  }
});

describe("lagosDisplayDate", () => {
  it("shows the date in Lagos (one hour ahead of UTC)", () => {
    assert.equal(lagosDisplayDate("2026-11-26T22:59:00+00:00"), "26 November 2026");
    assert.equal(lagosDisplayDate("2026-11-26T23:30:00+00:00"), "27 November 2026");
  });

  it("reads the database's form of a moment", () => {
    assert.equal(lagosDisplayDate("2026-01-05T08:00:00.123456+00:00"), "5 January 2026");
  });

  it("something that is not a date gives null", () => {
    assert.equal(lagosDisplayDate("yesterday"), null);
  });
});

describe("labels", () => {
  it("the role", () => {
    assert.equal(roleLabel("husband"), "Husband");
    assert.equal(roleLabel("wife"), "Wife");
  });

  it("the account kind", () => {
    assert.equal(accountKindLabel("wallet"), "Wallet");
    assert.equal(accountKindLabel("pot"), "Pot");
  });
});

describe("profileDisplay", () => {
  it("turns the checked profile into display values", () => {
    assert.deepEqual(profileDisplay(PROFILE), {
      fullName: "Ada Okafor",
      role: "Wife",
      phone: "00012345678",
      householdName: "Okafor household",
      ninMasked: `${"•".repeat(8)}222`,
      bvnMasked: `${"•".repeat(8)}444`,
      verifiedOn: "27 November 2026",
      accounts: [
        { name: "Family Wallet", kindLabel: "Wallet", accountNumber: "0001234567" },
        { name: "Rent", kindLabel: "Pot", accountNumber: null },
      ],
    });
  });
});

describe("the /app/profile source files", () => {
  const folder = new URL("../app/app/profile/", import.meta.url);
  const files = readdirSync(folder)
    .filter((name) => /\.(ts|tsx|css)$/.test(name))
    .map((name) => ({ name, source: readFileSync(new URL(name, folder), "utf8") }));

  it("there are source files to check", () => {
    assert.ok(files.length >= 3);
  });

  for (const { name, source } of files) {
    it(`${name}: no console calls, and neither forbidden word`, () => {
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });

    it(`${name}: reads no searchParams or params, so nothing in the address can choose a person`, () => {
      assert.ok(!/searchParams/.test(source), "searchParams");
      assert.ok(!/\bparams\b/.test(source), "params");
      assert.ok(!/useSearchParams|useParams/.test(source), "address hooks");
    });
  }

  it("page.tsx takes the person from the session and nowhere else", () => {
    const page = files.find((file) => file.name === "page.tsx");
    assert.ok(page !== undefined);
    assert.match(page.source, /export default async function ProfilePage\(\)/);
    assert.match(page.source, /const person = await requireSession\(\);/);
    assert.match(page.source, /getProfile\(person\.customerId\)/);
    assert.ok(!/formData|cookies\(\)|headers\(\)/.test(page.source));
  });
});
