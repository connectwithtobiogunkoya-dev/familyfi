// Tests for NUBAN account numbers.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { describe, it } from "node:test";

import { TEST_INSTITUTION_CODE, isValidAccountNumber, nubanCheckDigit } from "./nuban.ts";

// The older 3-digit method, written out separately so the 2020 method can
// be checked against it: a 3-digit bank code in front of the 9-digit
// serial (12 digits), weights 3,7,3,3,7,3,3,7,3,3,7,3, then 10 minus the
// remainder, or 0.
function threeDigitCheckDigit(bankCode: string, serial: string): number {
  const weights = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
  const digits = bankCode + serial;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * weights[i];
  }
  const check = 10 - (sum % 10);
  return check === 10 ? 0 : check;
}

describe("nubanCheckDigit: the CBN's worked example", () => {
  it("code 011 with serial 000001457 gives 9", () => {
    assert.equal(nubanCheckDigit("011", "000001457"), 9);
  });

  it("the same example in its 6-digit form, 000011, also gives 9", () => {
    assert.equal(nubanCheckDigit("000011", "000001457"), 9);
  });

  it("so the account number 0000014579 is valid for both forms of the code", () => {
    assert.equal(isValidAccountNumber("0000014579", "011"), true);
    assert.equal(isValidAccountNumber("0000014579", "000011"), true);
  });

  it("the separately written 3-digit method agrees on the example", () => {
    assert.equal(threeDigitCheckDigit("011", "000001457"), 9);
  });
});

describe("nubanCheckDigit: the 2020 method matches the 3-digit method", () => {
  it("for 2,000 random serials with FamilyFi's code 000", () => {
    for (let i = 0; i < 2000; i += 1) {
      const serial = String(randomInt(0, 1_000_000_000)).padStart(9, "0");
      assert.equal(
        nubanCheckDigit(TEST_INSTITUTION_CODE, serial),
        threeDigitCheckDigit("000", serial),
        `serial ${serial}`,
      );
    }
  });

  it("FamilyFi's code is 000", () => {
    assert.equal(TEST_INSTITUTION_CODE, "000");
  });

  it("the result is always a single digit", () => {
    for (let i = 0; i < 500; i += 1) {
      const digit = nubanCheckDigit("000", String(randomInt(0, 1_000_000_000)).padStart(9, "0"));
      assert.ok(Number.isInteger(digit) && digit >= 0 && digit <= 9);
    }
  });

  it("a sum that ends in 0 gives check digit 0, not 10", () => {
    assert.equal(nubanCheckDigit("000", "000000000"), 0);
  });
});

describe("nubanCheckDigit: bad input is refused", () => {
  const bad: Array<[label: string, code: unknown, serial: unknown]> = [
    ["an empty code", "", "000001457"],
    ["a 7-digit code", "0000011", "000001457"],
    ["a code with a letter", "01A", "000001457"],
    ["a serial of 8 digits", "011", "00001457"],
    ["a serial of 10 digits", "011", "0000014579"],
    ["a serial with a space", "011", "00000 1457"],
    ["a serial with a full-width digit", "011", "00000145７"],
    ["a number instead of text", 11, 1457],
    ["null", null, null],
  ];

  for (const [label, code, serial] of bad) {
    it(`${label} throws`, () => {
      assert.throws(() => nubanCheckDigit(code as string, serial as string), RangeError);
    });
  }
});

describe("isValidAccountNumber", () => {
  it("a number with the right check digit is valid", () => {
    const serial = "123456789";
    const number = serial + String(nubanCheckDigit("000", serial));
    assert.equal(isValidAccountNumber(number, "000"), true);
  });

  it("the same number with any other last digit is not valid", () => {
    const serial = "123456789";
    const right = nubanCheckDigit("000", serial);
    for (let digit = 0; digit <= 9; digit += 1) {
      if (digit !== right) {
        assert.equal(isValidAccountNumber(serial + String(digit), "000"), false);
      }
    }
  });

  const notNumbers: Array<[label: string, value: unknown]> = [
    ["9 digits", "000001457"],
    ["11 digits", "00000145790"],
    ["a space", "00000 14579"],
    ["a trailing line break", "0000014579\n"],
    ["letters", "ABCDEFGHIJ"],
    ["empty", ""],
    ["a number instead of text", 14579],
    ["null", null],
  ];

  for (const [label, value] of notNumbers) {
    it(`${label} is not a valid account number`, () => {
      assert.equal(isValidAccountNumber(value, "000"), false);
    });
  }

  it("a bad institution code throws", () => {
    assert.throws(() => isValidAccountNumber("0000014579", "ABC"), RangeError);
  });
});
