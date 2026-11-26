// Tests for the error mapper.
//
// Run with:  npm test
//
// The promise being checked: whatever goes wrong, a visitor can only ever
// be shown one of seven fixed sentences. No text from an error or from the
// address bar gets through.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AmountError, parseNairaToKobo } from "./amount.ts";
import {
  ERROR_CODES,
  NOT_ENOUGH_MONEY_PHRASE,
  errorSentence,
  readErrorCode,
  toErrorCode,
  type ErrorCode,
} from "./errors.ts";

// The real overdraft error, as post_transaction reports it.
const REAL_OVERDRAFT_MESSAGE =
  'Not enough money. Account "Family Wallet" (b0000000-0000-4000-8000-000000000002) would end at -500 kobo, and a wallet or pot cannot go below zero.';

const FIXED_SENTENCES: Record<ErrorCode, string> = {
  not_enough: "There isn't enough money there to move that amount.",
  bad_amount: "Please enter an amount like 1,000 or 1,000.50.",
  too_large: "The most you can move at once is ₦1,000,000.",
  replayed: "That was already done. Nothing moved a second time.",
  writes_off: "Money movement is paused right now. Please try again later.",
  ceiling: "This wallet has reached its limit, so no more money can be added.",
  unknown: "We could not move the money right now. Nothing was changed.",
};

describe("the fixed list of codes", () => {
  it("has exactly these seven codes", () => {
    assert.deepEqual(
      [...ERROR_CODES],
      ["not_enough", "bad_amount", "too_large", "replayed", "writes_off", "ceiling", "unknown"],
    );
  });
});

describe("toErrorCode: database errors", () => {
  it("the overdraft error gives not_enough", () => {
    assert.equal(toErrorCode({ code: "23514", message: REAL_OVERDRAFT_MESSAGE }), "not_enough");
  });

  it("the overdraft error gives not_enough when it arrives as an Error", () => {
    assert.equal(toErrorCode(new Error(REAL_OVERDRAFT_MESSAGE)), "not_enough");
  });

  it("a key already used for a different transaction gives unknown", () => {
    const message =
      'Idempotency key "web-123" was already used for a different transaction (c1) in this household. Use a new key for a new transaction.';
    assert.equal(toErrorCode({ code: "23505", message }), "unknown");
  });

  const otherDatabaseErrors: Array<[label: string, message: string]> = [
    ["an unbalanced transaction", "Transaction abc does not balance. Its entries add up to 5 kobo, but they must add up to exactly zero."],
    ["an account from another household", "Entry e1 uses account a1, which belongs to a different household than transaction t1."],
    ["a deadlock", "deadlock detected"],
    ["permission denied", "permission denied for function post_transaction"],
    ["the wrong isolation mode", 'post_transaction must run in read committed mode, but this save is using "serializable".'],
    ["an empty message", ""],
    // The phrase must open the message. Appearing later is not enough.
    ["the phrase in the middle of another message", "Something else failed. Not enough money is mentioned here."],
    ["the phrase in different capitals", "not enough money. Account ..."],
  ];

  for (const [label, message] of otherDatabaseErrors) {
    it(`${label} gives unknown`, () => {
      assert.equal(toErrorCode({ code: "XX000", message }), "unknown");
    });
  }
});

describe("toErrorCode: refused amounts", () => {
  const cases: Array<[problem: ConstructorParameters<typeof AmountError>[0], code: ErrorCode]> = [
    ["empty", "bad_amount"],
    ["malformed", "bad_amount"],
    ["negative", "bad_amount"],
    ["zero", "bad_amount"],
    ["too_many_decimals", "bad_amount"],
    ["too_large", "too_large"],
  ];

  for (const [problem, code] of cases) {
    it(`an AmountError with problem "${problem}" gives ${code}`, () => {
      assert.equal(toErrorCode(new AmountError(problem, "any message")), code);
    });
  }

  // The same, using errors the real parser throws.
  const typed: Array<[input: string, code: ErrorCode]> = [
    ["", "bad_amount"],
    ["abc", "bad_amount"],
    ["-5", "bad_amount"],
    ["0", "bad_amount"],
    ["1.234", "bad_amount"],
    ["1000000.01", "too_large"],
  ];

  for (const [input, code] of typed) {
    it(`typing "${input}" ends up as ${code}`, () => {
      let caught: unknown;
      try {
        parseNairaToKobo(input);
      } catch (error) {
        caught = error;
      }
      assert.equal(toErrorCode(caught), code);
    });
  }

  it("an AmountError whose message mentions money is still judged by its problem", () => {
    assert.equal(toErrorCode(new AmountError("malformed", REAL_OVERDRAFT_MESSAGE)), "bad_amount");
  });
});

describe("toErrorCode: anything unrecognised gives unknown", () => {
  const cases: Array<[label: string, value: unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a plain string", "Not enough money"],
    ["a number", 42],
    ["an empty object", {}],
    ["an object whose message is not text", { message: 12345 }],
    ["an object whose message is a list", { message: [REAL_OVERDRAFT_MESSAGE] }],
    ["a list", [REAL_OVERDRAFT_MESSAGE]],
    ["an ordinary Error", new Error("boom")],
    ["a TypeError", new TypeError("x is not a function")],
  ];

  for (const [label, value] of cases) {
    it(`${label} gives unknown`, () => {
      assert.equal(toErrorCode(value), "unknown");
    });
  }

  it("the result is always on the fixed list, whatever is passed in", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      "",
      0,
      {},
      [],
      new Error(REAL_OVERDRAFT_MESSAGE),
      { message: REAL_OVERDRAFT_MESSAGE },
      new AmountError("too_large", "x"),
      Symbol("s"),
      () => "x",
    ];
    for (const input of inputs) {
      assert.ok((ERROR_CODES as readonly string[]).includes(toErrorCode(input)));
    }
  });
});

describe("errorSentence: each code has one fixed sentence", () => {
  for (const code of ERROR_CODES) {
    it(`${code} gives its fixed sentence`, () => {
      assert.equal(errorSentence(code), FIXED_SENTENCES[code]);
    });
  }

  it("a value that is not on the list gets the unknown sentence, never its own text", () => {
    const sneaky = "<script>alert(1)</script>" as unknown as ErrorCode;
    assert.equal(errorSentence(sneaky), FIXED_SENTENCES.unknown);
  });
});

describe("the original error text never reaches the visitor", () => {
  it("the overdraft sentence contains no account name, id or amount from the error", () => {
    const sentence = errorSentence(toErrorCode({ code: "23514", message: REAL_OVERDRAFT_MESSAGE }));
    assert.equal(sentence, FIXED_SENTENCES.not_enough);
    assert.ok(!sentence.includes("Family Wallet"));
    assert.ok(!sentence.includes("b0000000"));
    assert.ok(!sentence.includes("-500"));
  });

  it("an error full of secrets-looking text becomes the plain unknown sentence", () => {
    const message = "connection to db.example.supabase.co failed for key test_key_abc123XYZ789";
    const sentence = errorSentence(toErrorCode(new Error(message)));
    assert.equal(sentence, FIXED_SENTENCES.unknown);
  });
});

describe("readErrorCode: a code from the address bar", () => {
  for (const code of ERROR_CODES) {
    it(`"${code}" is accepted`, () => {
      assert.equal(readErrorCode(code), code);
    });
  }

  const madeUp: Array<[label: string, value: unknown]> = [
    ["a script tag", "<script>"],
    ["a script that runs code", "<script>alert(1)</script>"],
    ["an empty string", ""],
    ["a made-up word", "banana"],
    ["a real code in capitals", "NOT_ENOUGH"],
    ["a real code with a space after it", "not_enough "],
    ["a real code with a line break after it", "not_enough\n"],
    ["a real code with extra text", "not_enough<script>"],
    ["two codes joined", "not_enough,ceiling"],
    ["very long text (100,000 characters)", "a".repeat(100000)],
    ["a real code repeated many times", "not_enough".repeat(1000)],
    ["a list containing a real code", ["not_enough"]],
    ["a list of two real codes", ["not_enough", "ceiling"]],
    ["an empty list", []],
    ["undefined (no error in the address)", undefined],
    ["null", null],
    ["a number", 1],
    ["an object", { error: "not_enough" }],
    ["a built-in word: constructor", "constructor"],
    ["a built-in word: __proto__", "__proto__"],
    ["a built-in word: toString", "toString"],
  ];

  for (const [label, value] of madeUp) {
    it(`${label} gives "no error"`, () => {
      assert.equal(readErrorCode(value), null);
    });
  }
});

describe("the wording this mapper depends on still exists in the migration", () => {
  // The mapper recognises the overdraft error by its opening words. If
  // someone rewords that message in a migration, this test fails, which is
  // the reminder to update the mapper too.
  const migration = readFileSync(
    new URL("../supabase/migrations/20261112120000_ledger_tables.sql", import.meta.url),
    "utf8",
  );

  it("the phrase is \"Not enough money\"", () => {
    assert.equal(NOT_ENOUGH_MONEY_PHRASE, "Not enough money");
  });

  it("the ledger migration raises an error that opens with that phrase", () => {
    assert.ok(
      migration.includes(`'${NOT_ENOUGH_MONEY_PHRASE}`),
      "the overdraft error message in the ledger migration no longer starts with the expected words",
    );
  });

  it("that phrase is inside the overdraft rule, check_no_overdraft", () => {
    const start = migration.indexOf("create function public.check_no_overdraft()");
    const end = migration.indexOf("create constraint trigger entries_30_no_overdraft");
    assert.ok(start !== -1 && end > start, "could not find the overdraft rule in the migration");
    assert.ok(migration.slice(start, end).includes(`'${NOT_ENOUGH_MONEY_PHRASE}`));
  });
});
