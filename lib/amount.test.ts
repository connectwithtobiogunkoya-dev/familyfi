// Tests for parseNairaToKobo.
//
// Run with:  npm test
//
// Each test gives the parser some typed text and checks either the exact
// number of kobo it returns, or the exact reason it refuses.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AmountError, MAX_AMOUNT_KOBO, parseNairaToKobo, type AmountProblem } from "./amount.ts";

// Check that some text is refused, and for the expected reason.
function assertRefused(text: unknown, problem: AmountProblem): void {
  assert.throws(
    () => parseNairaToKobo(text as string),
    (error: unknown) => error instanceof AmountError && error.problem === problem,
    // String(...) is used because it can describe any value, including a
    // bigint, when a test needs to report a failure.
    `expected ${String(text)} to be refused as "${problem}"`,
  );
}

describe("parseNairaToKobo: accepted amounts", () => {
  const cases: Array<[input: string, kobo: string]> = [
    ["1000", "100000"],
    ["1,000", "100000"],
    ["1000.5", "100050"],
    ["1000.50", "100050"],
    ["1,000.50", "100050"],
    ["0.01", "1"],
    ["0.50", "50"],
    ["0.5", "50"],
    ["1", "100"],
    ["10", "1000"],
    ["999", "99900"],
    ["12,345", "1234500"],
    ["123,456.78", "12345678"],
    ["999999.99", "99999999"],
    ["999,999.99", "99999999"],
  ];

  for (const [input, kobo] of cases) {
    it(`"${input}" gives ${kobo} kobo`, () => {
      assert.equal(parseNairaToKobo(input), BigInt(kobo));
    });
  }

  it("the result is a bigint, never an ordinary number", () => {
    assert.equal(typeof parseNairaToKobo("1000.50"), "bigint");
  });
});

describe("parseNairaToKobo: ordinary spaces at the ends are ignored", () => {
  it("\" 500 \" gives 50000 kobo", () => {
    assert.equal(parseNairaToKobo(" 500 "), BigInt(50000));
  });

  it("\"   1,000.50\" gives 100050 kobo", () => {
    assert.equal(parseNairaToKobo("   1,000.50"), BigInt(100050));
  });
});

describe("parseNairaToKobo: the maximum is exactly 100,000,000 kobo", () => {
  it("the maximum constant is 100000000", () => {
    assert.equal(MAX_AMOUNT_KOBO, BigInt(100000000));
  });

  it("exactly the maximum is accepted: \"1,000,000\"", () => {
    assert.equal(parseNairaToKobo("1,000,000"), BigInt(100000000));
  });

  it("exactly the maximum is accepted: \"1000000.00\"", () => {
    assert.equal(parseNairaToKobo("1000000.00"), BigInt(100000000));
  });

  it("one kobo under the maximum is accepted: \"999,999.99\"", () => {
    assert.equal(parseNairaToKobo("999,999.99"), BigInt(99999999));
  });

  it("one kobo over the maximum is refused: \"1000000.01\"", () => {
    assertRefused("1000000.01", "too_large");
  });

  it("one naira over the maximum is refused: \"1,000,001\"", () => {
    assertRefused("1,000,001", "too_large");
  });

  it("eight digits are refused: \"10000000\"", () => {
    assertRefused("10000000", "too_large");
  });

  it("twenty digits are refused: \"99999999999999999999\"", () => {
    assertRefused("99999999999999999999", "too_large");
  });

  it("a very long string of digits (10,000 of them) is refused", () => {
    assertRefused("9".repeat(10000), "too_large");
  });
});

describe("parseNairaToKobo: zero and negatives are refused", () => {
  for (const input of ["0", "0.0", "0.00"]) {
    it(`"${input}" is refused as zero`, () => {
      assertRefused(input, "zero");
    });
  }

  for (const input of ["-5", "-0.01", "-1,000", "-"]) {
    it(`"${input}" is refused as negative`, () => {
      assertRefused(input, "negative");
    });
  }
});

describe("parseNairaToKobo: more than two decimal places is refused", () => {
  for (const input of ["1.234", "10.000", "0.001", "1,000.505"]) {
    it(`"${input}" is refused`, () => {
      assertRefused(input, "too_many_decimals");
    });
  }
});

describe("parseNairaToKobo: empty text is refused", () => {
  for (const [label, input] of [
    ["an empty string", ""],
    ["one space", " "],
    ["several spaces", "     "],
  ] as const) {
    it(`${label} is refused as empty`, () => {
      assertRefused(input, "empty");
    });
  }
});

describe("parseNairaToKobo: leading zeros", () => {
  for (const input of ["007", "00500", "01,000", "00", "00.50", "0,500"]) {
    it(`"${input}" is refused`, () => {
      assertRefused(input, "malformed");
    });
  }

  it("\"0.50\" is still fine", () => {
    assert.equal(parseNairaToKobo("0.50"), BigInt(50));
  });
});

describe("parseNairaToKobo: malformed text is refused", () => {
  const cases: Array<[label: string, input: string]> = [
    ["letters", "abc"],
    ["a letter at the end", "12a"],
    ["a naira sign", "₦500"],
    ["scientific notation", "1e5"],
    ["a decimal point alone", "."],
    ["nothing before the point", ".5"],
    ["nothing after the point", "5."],
    ["nothing after the point, with a comma", "1,000."],
    ["two decimal points", "1.2.3"],
    ["a comma after two digits", "1,00"],
    ["Indian-style grouping", "10,00,000"],
    ["a comma at the start", ",500"],
    ["two commas together", "1,,000"],
    ["a comma at the end", "1,000,"],
    ["four digits before a comma", "1000,000"],
    ["a comma used as a decimal mark", "1000,50"],
    ["a comma after the decimal point", "1.5,0"],
    ["a space in the middle", "1 000"],
    ["a plus sign", "+500"],
    ["a minus sign at the end", "500-"],
    ["a percent sign", "50%"],
    ["hexadecimal", "0x10"],
  ];

  for (const [label, input] of cases) {
    it(`${label} is refused: "${input}"`, () => {
      assertRefused(input, "malformed");
    });
  }
});

describe("parseNairaToKobo: only plain digits 0 to 9 count as digits", () => {
  const cases: Array<[label: string, input: string]> = [
    ["Arabic-Indic digits", "١٢٣"],
    ["full-width digits", "１２３"],
    ["Devanagari digits", "१२३"],
    ["a full-width digit among plain ones", "1２3"],
    ["a full-width decimal point", "1．50"],
    ["a full-width comma", "1，000"],
  ];

  for (const [label, input] of cases) {
    it(`${label} are refused: "${input}"`, () => {
      assertRefused(input, "malformed");
    });
  }
});

describe("parseNairaToKobo: tabs and line breaks are not trimmed", () => {
  const cases: Array<[label: string, input: string]> = [
    ["a trailing line break", "500\n"],
    ["a leading tab", "\t500"],
    ["a leading line break", "\n500"],
    ["a trailing tab", "500\t"],
    ["a trailing carriage return and line break", "500\r\n"],
    ["a line break after a decimal amount", "500.50\n"],
    ["a line break in the middle", "5\n00"],
    ["a non-breaking space at the start", " 500"],
    ["a line break after spaces", "500 \n"],
  ];

  for (const [label, input] of cases) {
    it(`${label} is refused`, () => {
      assertRefused(input, "malformed");
    });
  }

  it("text that is only a line break is refused", () => {
    assertRefused("\n", "malformed");
  });
});

describe("parseNairaToKobo: anything that is not text is refused", () => {
  const cases: Array<[label: string, input: unknown]> = [
    ["the number 1000", 1000],
    ["the number 1000.5", 1000.5],
    ["a bigint", BigInt(1000)],
    ["null", null],
    ["undefined", undefined],
    ["a list", ["1000"]],
  ];

  for (const [label, input] of cases) {
    it(`${label} is refused`, () => {
      assertRefused(input, "malformed");
    });
  }
});
