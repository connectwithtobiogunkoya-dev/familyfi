// Tests for the statement helpers.
//
// Run with:  npm test
//
// These need no database. They check that an account id from an address
// is either a clean UUID or nothing, and that a statement row keeps its
// amounts exactly as text.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatNaira } from "./money.ts";
import {
  balancesAgree,
  describeAmount,
  formatStatementDate,
  normaliseAccountId,
  toStatementLine,
  type StatementLine,
} from "./statement.ts";

const WALLET_ID = "b0000000-0000-4000-8000-000000000002";

describe("normaliseAccountId: properly formed UUIDs are accepted", () => {
  const cases: Array<[label: string, input: string, expected: string]> = [
    ["the seed wallet id, lowercase", WALLET_ID, WALLET_ID],
    ["a random-looking id, lowercase", "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b", "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b"],
    ["the same id in uppercase", "3F2A9C1E-7B4D-4E8A-9F01-2C3D4E5F6A7B", "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b"],
    ["mixed case", "3f2A9c1E-7b4D-4e8A-9F01-2c3D4e5F6a7B", "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b"],
    ["all zeros", "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"],
    ["all f, uppercase", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
  ];

  for (const [label, input, expected] of cases) {
    it(`${label} gives ${expected}`, () => {
      assert.equal(normaliseAccountId(input), expected);
    });
  }
});

describe("normaliseAccountId: everything else gives null", () => {
  const cases: Array<[label: string, input: unknown]> = [
    ["an empty string", ""],
    ["plain text", "wallet"],
    ["a UUID with an extra character at the end", `${WALLET_ID}0`],
    ["a UUID with an extra character at the start", `0${WALLET_ID}`],
    ["a UUID with a trailing line break", `${WALLET_ID}\n`],
    ["a UUID with a leading space", ` ${WALLET_ID}`],
    ["a UUID with a trailing space", `${WALLET_ID} `],
    ["a UUID inside a longer string", `account-${WALLET_ID}-statement`],
    ["a UUID followed by a path", `${WALLET_ID}/../secret`],
    ["a UUID one character short", WALLET_ID.slice(0, 35)],
    ["\"../\"", "../"],
    ["a path climbing out of the folder", "../../etc/passwd"],
    ["a single quote mark", "'"],
    ["a double quote mark", "\""],
    ["SQL-looking text", "' or 1=1 --"],
    ["SQL-looking text padded to 36 characters", "' or 1=1 -- ''''''''''''''''''''''''"],
    ["a UUID whose last character is a quote", "b0000000-0000-4000-8000-00000000000'"],
    ["a UUID in braces", `{${WALLET_ID}}`],
    ["a UUID without hyphens", "b0000000000040008000000000000002"],
    ["hyphens in the wrong places", "b000000-00000-4000-8000-000000000002"],
    ["a letter that is not hexadecimal", "g0000000-0000-4000-8000-000000000002"],
    ["full-width digits", "１0000000-0000-4000-8000-000000000002"],
    ["an underscore instead of a hyphen", "b0000000_0000-4000-8000-000000000002"],
    ["a list holding a valid UUID", [WALLET_ID]],
    ["an empty list", []],
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345],
    ["an object", { id: WALLET_ID }],
    ["a 100,000-character string", "a".repeat(100000)],
    ["a 100,000-character string of hexadecimal digits", "f".repeat(100000)],
  ];

  for (const [label, input] of cases) {
    it(`${label} gives null`, () => {
      assert.equal(normaliseAccountId(input), null);
    });
  }
});

describe("toStatementLine: a good row", () => {
  const row = {
    description: "Fund the family wallet from the bank",
    created_at: "2026-11-12T10:15:00.123456+00:00",
    amount_kobo: "10000000",
    balance_after_kobo: "10000000",
  };

  it("keeps the four fields exactly", () => {
    assert.deepEqual(toStatementLine(row), row);
  });

  it("keeps a negative amount as text", () => {
    const line = toStatementLine({ ...row, amount_kobo: "-4000000", balance_after_kobo: "6000000" });
    assert.equal(line.amount_kobo, "-4000000");
    assert.equal(line.balance_after_kobo, "6000000");
  });

  it("accepts a balance of zero", () => {
    assert.equal(toStatementLine({ ...row, balance_after_kobo: "0" }).balance_after_kobo, "0");
  });

  it("leaves seq and anything else behind", () => {
    const line = toStatementLine({ ...row, seq: "42", entry_id: WALLET_ID, extra: "x" });
    assert.deepEqual(Object.keys(line).sort(), ["amount_kobo", "balance_after_kobo", "created_at", "description"]);
  });
});

describe("toStatementLine: amounts too large for ordinary numbers survive exactly", () => {
  // 9,007,199,254,740,991 is the largest whole number an ordinary
  // JavaScript number can hold exactly. Beyond it, numbers get rounded.
  const cases: Array<[label: string, kobo: string]> = [
    ["the largest exact ordinary number", "9007199254740991"],
    ["one more than that", "9007199254740992"],
    ["two more than that (rounds if ever made a number)", "9007199254740993"],
    ["the largest value the database can hold", "9223372036854775807"],
    ["the most negative value the database can hold", "-9223372036854775808"],
  ];

  for (const [label, kobo] of cases) {
    it(`${label}: "${kobo}" stays "${kobo}"`, () => {
      const line = toStatementLine({
        description: "Large",
        created_at: "2026-11-12T10:15:00+00:00",
        amount_kobo: kobo,
        balance_after_kobo: kobo,
      });
      assert.equal(line.amount_kobo, kobo);
      assert.equal(line.balance_after_kobo, kobo);
      assert.equal(typeof line.amount_kobo, "string");
    });
  }

  it("the test itself is meaningful: an ordinary number would have changed the last one", () => {
    assert.notEqual(String(Number("9007199254740993")), "9007199254740993");
  });
});

describe("toStatementLine: bad rows are refused", () => {
  const good = {
    description: "Set aside money for rent",
    created_at: "2026-11-12T10:15:00+00:00",
    amount_kobo: "4000000",
    balance_after_kobo: "4000000",
  };

  const cases: Array<[label: string, row: unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "row"],
    ["a list", [good]],
    ["an empty object", {}],
    ["an amount sent as an ordinary number", { ...good, amount_kobo: 4000000 }],
    ["a balance sent as an ordinary number", { ...good, balance_after_kobo: 4000000 }],
    ["an amount with decimals", { ...good, amount_kobo: "4000000.5" }],
    ["an amount with a trailing line break", { ...good, amount_kobo: "4000000\n" }],
    ["an amount with a space", { ...good, amount_kobo: "4 000 000" }],
    ["an amount with commas", { ...good, amount_kobo: "4,000,000" }],
    ["an empty amount", { ...good, amount_kobo: "" }],
    ["a minus sign alone", { ...good, amount_kobo: "-" }],
    ["a missing amount", { description: good.description, created_at: good.created_at, balance_after_kobo: "1" }],
    ["a missing balance", { description: good.description, created_at: good.created_at, amount_kobo: "1" }],
    ["a missing description", { created_at: good.created_at, amount_kobo: "1", balance_after_kobo: "1" }],
    ["a description that is not text", { ...good, description: 7 }],
    ["an empty date", { ...good, created_at: "" }],
    ["a date that is not text", { ...good, created_at: 1700000000 }],
  ];

  for (const [label, row] of cases) {
    it(`${label} is refused`, () => {
      assert.throws(() => toStatementLine(row), /unexpected form/);
    });
  }
});

describe("formatStatementDate: Nigerian time, as \"12 Nov 2026, 11:15\"", () => {
  const cases: Array<[label: string, input: string, expected: string]> = [
    ["the example from the plan", "2026-11-12T10:15:00.123456+00:00", "12 Nov 2026, 11:15"],
    ["the same moment written in Lagos time", "2026-11-12T11:15:00+01:00", "12 Nov 2026, 11:15"],
    ["a time given as Z (UTC)", "2026-11-12T10:15:00Z", "12 Nov 2026, 11:15"],
    ["seconds are dropped, not rounded up", "2026-11-12T10:15:59.999999+00:00", "12 Nov 2026, 11:15"],
    ["a single-digit day has no leading zero", "2026-11-03T10:15:00+00:00", "3 Nov 2026, 11:15"],
    ["an early hour keeps its leading zero", "2026-11-12T06:05:00+00:00", "12 Nov 2026, 07:05"],
    ["late evening in UTC is the next day in Lagos", "2026-11-12T23:30:00+00:00", "13 Nov 2026, 00:30"],
    ["the last minute of the year in UTC is the new year in Lagos", "2026-12-31T23:59:00+00:00", "1 Jan 2027, 00:59"],
    ["midnight in Lagos is 00:00, not 24:00", "2026-11-12T23:00:00+00:00", "13 Nov 2026, 00:00"],
    ["September is written Sep", "2026-09-12T10:15:00+00:00", "12 Sep 2026, 11:15"],
    ["a summer date is still one hour ahead (no daylight saving)", "2026-07-01T12:00:00+00:00", "1 Jul 2026, 13:00"],
  ];

  for (const [label, input, expected] of cases) {
    it(`${label}: "${input}" gives "${expected}"`, () => {
      assert.equal(formatStatementDate(input), expected);
    });
  }

  const unreadable: Array<[label: string, input: unknown]> = [
    ["an empty string", ""],
    ["plain text", "yesterday"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1700000000],
  ];

  for (const [label, input] of unreadable) {
    it(`${label} gives "Date unknown"`, () => {
      assert.equal(formatStatementDate(input), "Date unknown");
    });
  }
});

describe("describeAmount: In and Out are words as well as signs", () => {
  it("money in shows In and a plus sign", () => {
    assert.deepEqual(describeAmount("10000000", formatNaira), { direction: "In", text: "+₦100,000.00" });
  });

  it("money out shows Out and formatNaira's minus sign", () => {
    assert.deepEqual(describeAmount("-4000000", formatNaira), { direction: "Out", text: "-₦40,000.00" });
  });

  it("one kobo out", () => {
    assert.deepEqual(describeAmount("-1", formatNaira), { direction: "Out", text: "-₦0.01" });
  });

  it("formatNaira is used unchanged: a negative amount is passed to it as it is", () => {
    const seen: string[] = [];
    describeAmount("-1500000", (kobo) => {
      seen.push(kobo);
      return formatNaira(kobo);
    });
    assert.deepEqual(seen, ["-1500000"]);
  });

  it("an amount too large for ordinary numbers is shown exactly", () => {
    assert.deepEqual(describeAmount("9007199254740993", formatNaira), {
      direction: "In",
      text: "+₦90,071,992,547,409.93",
    });
  });
});

describe("balancesAgree: the safety check before showing Balance after", () => {
  const line = (balanceAfter: string): StatementLine => ({
    description: "x",
    created_at: "2026-11-12T10:15:00+00:00",
    amount_kobo: "1",
    balance_after_kobo: balanceAfter,
  });

  it("agree when the newest line matches the balance", () => {
    assert.equal(balancesAgree("1500000", [line("1500000"), line("3000000")]), true);
  });

  it("differ when the newest line does not match the balance", () => {
    assert.equal(balancesAgree("1500000", [line("2500000"), line("1500000")]), false);
  });

  it("only the newest line (the first) is compared, not an older one", () => {
    assert.equal(balancesAgree("3000000", [line("1500000"), line("3000000")]), false);
  });

  it("an empty statement agrees with a balance of \"0\"", () => {
    assert.equal(balancesAgree("0", []), true);
  });

  it("an empty statement does not agree with any other balance", () => {
    assert.equal(balancesAgree("1500000", []), false);
  });

  it("a one-kobo difference counts as different", () => {
    assert.equal(balancesAgree("1500000", [line("1500001")]), false);
  });

  it("large amounts are compared exactly, without rounding", () => {
    assert.equal(balancesAgree("9007199254740993", [line("9007199254740992")]), false);
    assert.equal(balancesAgree("9007199254740993", [line("9007199254740993")]), true);
  });
});
