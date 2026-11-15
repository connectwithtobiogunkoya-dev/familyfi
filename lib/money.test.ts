// Tests for formatNaira.
//
// Run with:  node --test lib/money.test.ts
//
// These use Node's built-in test runner, so no extra package is needed.
// Each test gives formatNaira an input and checks the exact text it
// returns, or checks that a bad input is refused.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatNaira } from "./money.ts";

describe("formatNaira: amounts given as text", () => {
  const cases: Array<[input: string, expected: string]> = [
    ["0", "₦0.00"],
    ["1", "₦0.01"],
    ["99", "₦0.99"],
    ["100", "₦1.00"],
    ["1500000", "₦15,000.00"],
    ["10000000", "₦100,000.00"],
    ["4000000", "₦40,000.00"],
    ["3000000", "₦30,000.00"],
    ["-1", "-₦0.01"],
    ["-100000", "-₦1,000.00"],
    // The largest value the database can hold (a bigint column).
    ["9223372036854775807", "₦92,233,720,368,547,758.07"],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" gives ${expected}`, () => {
      assert.equal(formatNaira(input), expected);
    });
  }
});

describe("formatNaira: bigint input matches string input", () => {
  const inputs = ["0", "1", "100", "1500000", "-100000", "9223372036854775807"];

  for (const input of inputs) {
    it(`bigint ${input} gives the same text as "${input}"`, () => {
      assert.equal(formatNaira(BigInt(input)), formatNaira(input));
    });
  }
});

describe("formatNaira: bad input is refused", () => {
  // Ordinary JavaScript numbers must be refused, even whole ones, so a
  // floating point value can never slip in. TypeScript already forbids
  // passing a number, so the tests switch that check off on purpose
  // ("as unknown as string") to prove the function also refuses at run time.
  const numbers: Array<[label: string, value: number]> = [
    ["a whole number (1500000)", 1500000],
    ["a decimal number (15000.5)", 15000.5],
    ["zero (0)", 0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  for (const [label, value] of numbers) {
    it(`a JavaScript number is refused: ${label}`, () => {
      assert.throws(() => formatNaira(value as unknown as string), TypeError);
    });
  }

  const badText: Array<[label: string, value: string]> = [
    ["an empty string", ""],
    ["a decimal point", "150.50"],
    ["a decimal point with zeros", "150.00"],
    ["scientific notation", "1e5"],
    ["a space in the middle", "1 500"],
    ["a leading space", " 1500"],
    ["a trailing space", "1500 "],
    ["thousands commas", "1,500"],
    ["letters", "abc"],
    ["a naira sign", "₦1500"],
    ["a plus sign", "+1500"],
    ["a minus sign alone", "-"],
    ["two minus signs", "--5"],
    ["a minus sign at the end", "5-"],
  ];

  for (const [label, value] of badText) {
    it(`text with ${label} is refused: "${value}"`, () => {
      assert.throws(() => formatNaira(value), TypeError);
    });
  }

  it("null and undefined are refused", () => {
    assert.throws(() => formatNaira(null as unknown as string), TypeError);
    assert.throws(() => formatNaira(undefined as unknown as string), TypeError);
  });
});
