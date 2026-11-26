// Tests for the write path.
//
// Run with:  npm test
//
// These test the rules in lib/moves-core.ts with a pretend database
// (FakeDatabase below) instead of the real one, so nothing here touches
// Supabase and no real money moves. lib/moves.ts, which plugs in the
// real database, is server-only and cannot be loaded by Node's test
// runner, so it is checked by the build instead.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOUSEHOLD_CEILING_KOBO,
  buildEntries,
  ceilingAllows,
  databaseKey,
  householdTotalKobo,
  isAllowedMove,
  runAddMoney,
  runMoveMoney,
  type HouseholdAccount,
  type LedgerEntry,
  type MoveDeps,
  type MoveResult,
  type PostOutcome,
  type PostRequest,
} from "./moves-core.ts";

// ---------------------------------------------------------------------
// The pretend household
// ---------------------------------------------------------------------

const BANK = "b0000000-0000-4000-8000-000000000001";
const WALLET = "b0000000-0000-4000-8000-000000000002";
const RENT = "b0000000-0000-4000-8000-000000000003";
const SCHOOL = "b0000000-0000-4000-8000-000000000004";
const GROCERIES = "b0000000-0000-4000-8000-000000000005";
// An account that belongs to a different household. The pretend database
// never returns it, exactly as the real one would not.
const OTHER_FAMILY_POT = "c0000000-0000-4000-8000-000000000009";
// Properly formed, but no such account exists anywhere.
const NO_SUCH_ACCOUNT = "eeeeeeee-0000-4000-8000-000000000000";

const KEY = "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";
const KEY_2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

// Something that looks like a secret, put inside a database error, to
// prove it never reaches a result.
const SECRET_LOOKING_TEXT = "test_key_abc123XYZ789";

function seedAccounts(): HouseholdAccount[] {
  return [
    { account_id: BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: "-10000000" },
    { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "1500000" },
    { account_id: RENT, name: "Rent", kind: "pot", balance_kobo: "4000000" },
    { account_id: SCHOOL, name: "School fees", kind: "pot", balance_kobo: "3000000" },
    { account_id: GROCERIES, name: "Groceries", kind: "pot", balance_kobo: "1500000" },
  ];
}

// A scripted answer for one call to post_transaction:
//   "real"     behave like post_transaction
//   "lost"     save it like post_transaction, but the answer never arrives
//   "nothing"  nothing is saved and no answer arrives
//   "throw"    the call itself throws
type Script = "real" | "lost" | "nothing" | "throw";

// A small pretend database that behaves like post_transaction: it applies
// entries, refuses overdrafts on wallets and pots, and treats a repeated
// key as a replay if the entries are the same.
class FakeDatabase {
  accounts: HouseholdAccount[];
  writes: boolean;
  loads = 0;
  posts: PostRequest[] = [];
  saved: PostRequest[] = [];
  logs: string[] = [];
  script: Script[] = [];
  loadFails = false;

  constructor(accounts: HouseholdAccount[] = seedAccounts(), writes = true) {
    this.accounts = accounts.map((account) => ({ ...account }));
    this.writes = writes;
  }

  balance(id: string): bigint {
    const account = this.accounts.find((a) => a.account_id === id);
    return account === undefined ? BigInt(0) : BigInt(account.balance_kobo);
  }

  private signature(entries: LedgerEntry[]): string {
    return entries
      .map((e) => `${e.account_id}:${e.amount_kobo}`)
      .sort()
      .join("|");
  }

  private realPost(request: PostRequest): PostOutcome {
    const earlier = this.saved.find((s) => s.idempotencyKey === request.idempotencyKey);
    if (earlier !== undefined) {
      if (this.signature(earlier.entries) === this.signature(request.entries)) {
        return { kind: "posted", replayed: true };
      }
      return {
        kind: "database_error",
        code: "23505",
        message: `Idempotency key "${request.idempotencyKey}" was already used for a different transaction (${WALLET}) in this household.`,
      };
    }

    for (const entry of request.entries) {
      const account = this.accounts.find((a) => a.account_id === entry.account_id);
      if (account === undefined) {
        return { kind: "database_error", code: "22023", message: `Account ${entry.account_id} does not exist.` };
      }
      const after = BigInt(account.balance_kobo) + BigInt(entry.amount_kobo);
      if (account.kind !== "bank_source" && after < BigInt(0)) {
        return {
          kind: "database_error",
          code: "23514",
          message: `Not enough money. Account "${account.name}" (${account.account_id}) would end at ${after} kobo, and a wallet or pot cannot go below zero. ${SECRET_LOOKING_TEXT}`,
        };
      }
    }

    for (const entry of request.entries) {
      const account = this.accounts.find((a) => a.account_id === entry.account_id)!;
      account.balance_kobo = (BigInt(account.balance_kobo) + BigInt(entry.amount_kobo)).toString();
    }
    this.saved.push(request);
    return { kind: "posted", replayed: false };
  }

  deps(): MoveDeps {
    return {
      writesEnabled: () => this.writes,
      loadHouseholdAccounts: async () => {
        this.loads += 1;
        if (this.loadFails) {
          return { kind: "failed", code: "PGRST000", message: `could not connect ${SECRET_LOOKING_TEXT}` };
        }
        return { kind: "loaded", accounts: this.accounts.map((account) => ({ ...account })) };
      },
      postTransaction: async (request) => {
        this.posts.push(request);
        const step = this.script.shift() ?? "real";
        if (step === "throw") {
          throw new Error("fetch failed");
        }
        if (step === "nothing") {
          return { kind: "no_answer", message: "TypeError: fetch failed" };
        }
        const outcome = this.realPost(request);
        return step === "lost" ? { kind: "no_answer", message: "AbortError: The operation was aborted" } : outcome;
      },
      logError: (line) => {
        this.logs.push(line);
      },
    };
  }
}

function sum(entries: LedgerEntry[]): bigint {
  return entries.reduce((total, e) => total + BigInt(e.amount_kobo), BigInt(0));
}

// ---------------------------------------------------------------------
// The kill switch
// ---------------------------------------------------------------------

describe("writes off: refused before any database call", () => {
  it("addMoney is refused as writes_off and the database is never called", async () => {
    const db = new FakeDatabase(seedAccounts(), false);
    const result = await runAddMoney({ amount: "1000", idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "refused", code: "writes_off" });
    assert.equal(db.loads, 0);
    assert.equal(db.posts.length, 0);
  });

  it("moveMoney is refused as writes_off and the database is never called", async () => {
    const db = new FakeDatabase(seedAccounts(), false);
    const result = await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "refused", code: "writes_off" });
    assert.equal(db.loads, 0);
    assert.equal(db.posts.length, 0);
  });

  it("writes_off wins even when every other input is bad", async () => {
    const db = new FakeDatabase(seedAccounts(), false);
    const result = await runMoveMoney({ amount: "abc", fromAccountId: "x", toAccountId: "x", idempotencyKey: "nope" }, db.deps());
    assert.deepEqual(result, { status: "refused", code: "writes_off" });
    assert.equal(db.loads, 0);
  });
});

// ---------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------

describe("amounts", () => {
  const cases: Array<[label: string, amount: unknown, code: string]> = [
    ["empty", "", "bad_amount"],
    ["letters", "abc", "bad_amount"],
    ["zero", "0", "bad_amount"],
    ["negative", "-5", "bad_amount"],
    ["three decimals", "1.234", "bad_amount"],
    ["an ordinary number instead of text", 1000, "bad_amount"],
    ["nothing at all", undefined, "bad_amount"],
    ["one kobo over the per-move maximum", "1000000.01", "too_large"],
    ["one naira over the per-move maximum", "1,000,001", "too_large"],
    ["a very long number", "9".repeat(500), "too_large"],
  ];

  for (const [label, amount, code] of cases) {
    it(`addMoney: ${label} is refused as ${code}, without reading the database`, async () => {
      const db = new FakeDatabase();
      const result = await runAddMoney({ amount, idempotencyKey: KEY }, db.deps());
      assert.deepEqual(result, { status: "refused", code });
      assert.equal(db.loads, 0);
      assert.equal(db.posts.length, 0);
    });

    it(`moveMoney: ${label} is refused as ${code}, without reading the database`, async () => {
      const db = new FakeDatabase();
      const result = await runMoveMoney({ amount, fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
      assert.deepEqual(result, { status: "refused", code });
      assert.equal(db.loads, 0);
    });
  }

  it("exactly the per-move maximum is accepted when there is room", async () => {
    const db = new FakeDatabase([
      { account_id: BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: "0" },
      { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "0" },
    ]);
    const result = await runAddMoney({ amount: "1,000,000", idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "done" });
    assert.equal(db.balance(WALLET), BigInt(100000000));
  });
});

// ---------------------------------------------------------------------
// Keys and ids
// ---------------------------------------------------------------------

describe("idempotency keys", () => {
  const badKeys: Array<[label: string, key: unknown]> = [
    ["empty", ""],
    ["plain text", "not-a-uuid"],
    ["a UUID with an extra character", `${KEY}0`],
    ["a UUID with a trailing line break", `${KEY}\n`],
    ["a key that already has the prefix", `add-${KEY}`],
    ["a number", 12345],
    ["null", null],
    ["undefined", undefined],
    ["a list", [KEY]],
  ];

  for (const [label, key] of badKeys) {
    it(`${label} is refused as unknown, without reading the database`, async () => {
      const db = new FakeDatabase();
      assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: key }, db.deps()), { status: "refused", code: "unknown" });
      assert.deepEqual(
        await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: key }, db.deps()),
        { status: "refused", code: "unknown" },
      );
      assert.equal(db.loads, 0);
      assert.equal(db.posts.length, 0);
    });
  }

  it("an uppercase key is sent as add-<lowercase>", async () => {
    const db = new FakeDatabase();
    await runAddMoney({ amount: "1000", idempotencyKey: KEY.toUpperCase() }, db.deps());
    assert.equal(db.posts[0].idempotencyKey, `add-${KEY}`);
  });

  it("a move key is sent as move-<uuid>", async () => {
    const db = new FakeDatabase();
    await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
    assert.equal(db.posts[0].idempotencyKey, `move-${KEY}`);
  });

  it("databaseKey gives the prefixed lowercase key, or null", () => {
    assert.equal(databaseKey("add", KEY.toUpperCase()), `add-${KEY}`);
    assert.equal(databaseKey("move", KEY), `move-${KEY}`);
    assert.equal(databaseKey("add", "nope"), null);
  });
});

describe("account ids", () => {
  const badIds: Array<[label: string, id: unknown]> = [
    ["empty", ""],
    ["plain text", "wallet"],
    ["a path", "../"],
    ["SQL-looking text", "' or 1=1 --"],
    ["null", null],
    ["a number", 7],
    ["a list", [RENT]],
  ];

  for (const [label, id] of badIds) {
    it(`a "from" id that is ${label} is refused as unknown, without reading the database`, async () => {
      const db = new FakeDatabase();
      const result = await runMoveMoney({ amount: "1000", fromAccountId: id, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
      assert.deepEqual(result, { status: "refused", code: "unknown" });
      assert.equal(db.loads, 0);
    });

    it(`a "to" id that is ${label} is refused as unknown, without reading the database`, async () => {
      const db = new FakeDatabase();
      const result = await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: id, idempotencyKey: KEY }, db.deps());
      assert.deepEqual(result, { status: "refused", code: "unknown" });
      assert.equal(db.loads, 0);
    });
  }

  it("an id in uppercase is matched to the same account", async () => {
    const db = new FakeDatabase();
    const result = await runMoveMoney(
      { amount: "1000", fromAccountId: WALLET.toUpperCase(), toAccountId: RENT.toUpperCase(), idempotencyKey: KEY },
      db.deps(),
    );
    assert.deepEqual(result, { status: "done" });
  });
});

// ---------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------

describe("moveMoney rules", () => {
  const refusedMoves: Array<[label: string, from: string, to: string]> = [
    ["bank to pot", BANK, RENT],
    ["bank to wallet (only Add money may do this)", BANK, WALLET],
    ["wallet to bank (wrong direction)", WALLET, BANK],
    ["pot to bank (wrong direction)", RENT, BANK],
    ["pot to pot", RENT, SCHOOL],
    ["the same pot to itself", RENT, RENT],
    ["the wallet to itself", WALLET, WALLET],
    ["an account that does not exist", WALLET, NO_SUCH_ACCOUNT],
    ["from an account that does not exist", NO_SUCH_ACCOUNT, WALLET],
    ["another household's pot", WALLET, OTHER_FAMILY_POT],
    ["from another household's pot", OTHER_FAMILY_POT, WALLET],
  ];

  for (const [label, from, to] of refusedMoves) {
    it(`${label} is refused as unknown and nothing is posted`, async () => {
      const db = new FakeDatabase();
      const result = await runMoveMoney({ amount: "1000", fromAccountId: from, toAccountId: to, idempotencyKey: KEY }, db.deps());
      assert.deepEqual(result, { status: "refused", code: "unknown" });
      assert.equal(db.posts.length, 0);
    });
  }

  it("the same account given twice is refused before the database is read", async () => {
    const db = new FakeDatabase();
    await runMoveMoney({ amount: "1000", fromAccountId: RENT, toAccountId: RENT.toUpperCase(), idempotencyKey: KEY }, db.deps());
    assert.equal(db.loads, 0);
  });

  it("wallet to pot is done, with the right entries and description", async () => {
    const db = new FakeDatabase();
    const result = await runMoveMoney({ amount: "1,000.50", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "done" });
    assert.deepEqual(db.posts[0].entries, [
      { account_id: WALLET, amount_kobo: -100050 },
      { account_id: RENT, amount_kobo: 100050 },
    ]);
    assert.equal(db.posts[0].description, "Move money from Family Wallet to Rent");
    assert.equal(db.balance(WALLET), BigInt(1500000 - 100050));
    assert.equal(db.balance(RENT), BigInt(4000000 + 100050));
  });

  it("pot to wallet is done", async () => {
    const db = new FakeDatabase();
    const result = await runMoveMoney({ amount: "500", fromAccountId: SCHOOL, toAccountId: WALLET, idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "done" });
    assert.equal(db.posts[0].description, "Move money from School fees to Family Wallet");
  });

  it("the names in the description come from the database, never the caller", async () => {
    const db = new FakeDatabase();
    await runMoveMoney(
      { amount: "500", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY, name: "Hacked", kind: "pot" } as never,
      db.deps(),
    );
    assert.equal(db.posts[0].description, "Move money from Family Wallet to Rent");
  });

  it("isAllowedMove allows only wallet to pot and pot to wallet", () => {
    const kinds = ["wallet", "pot", "bank_source"] as const;
    for (const from of kinds) {
      for (const to of kinds) {
        const expected = (from === "wallet" && to === "pot") || (from === "pot" && to === "wallet");
        assert.equal(isAllowedMove(from, to), expected, `${from} to ${to}`);
      }
    }
  });
});

describe("addMoney rules", () => {
  it("goes from the bank to the wallet, with the fixed description", async () => {
    const db = new FakeDatabase();
    const result = await runAddMoney({ amount: "10,000", idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "done" });
    assert.deepEqual(db.posts[0].entries, [
      { account_id: BANK, amount_kobo: -1000000 },
      { account_id: WALLET, amount_kobo: 1000000 },
    ]);
    assert.equal(db.posts[0].description, "Add money to the wallet");
    assert.equal(db.balance(WALLET), BigInt(2500000));
  });

  it("accounts named by the caller are ignored", async () => {
    const db = new FakeDatabase();
    await runAddMoney({ amount: "100", idempotencyKey: KEY, fromAccountId: RENT, toAccountId: SCHOOL } as never, db.deps());
    assert.deepEqual(
      db.posts[0].entries.map((e) => e.account_id),
      [BANK, WALLET],
    );
  });

  it("a household with no wallet is refused as unknown", async () => {
    const db = new FakeDatabase(seedAccounts().filter((a) => a.kind !== "wallet"));
    assert.deepEqual(await runAddMoney({ amount: "100", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "unknown" });
    assert.equal(db.posts.length, 0);
  });

  it("a household with no bank account is refused as unknown", async () => {
    const db = new FakeDatabase(seedAccounts().filter((a) => a.kind !== "bank_source"));
    assert.deepEqual(await runAddMoney({ amount: "100", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "unknown" });
  });

  it("a household with two wallets is refused as unknown", async () => {
    const accounts = seedAccounts();
    accounts.push({ account_id: NO_SUCH_ACCOUNT, name: "Second Wallet", kind: "wallet", balance_kobo: "0" });
    const db = new FakeDatabase(accounts);
    assert.deepEqual(await runAddMoney({ amount: "100", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "unknown" });
  });
});

// ---------------------------------------------------------------------
// The ceiling
// ---------------------------------------------------------------------

describe("the household ceiling for Add money", () => {
  it("is 200,000,000 kobo (₦2,000,000)", () => {
    assert.equal(HOUSEHOLD_CEILING_KOBO, BigInt(200000000));
  });

  // A household whose wallet and pots hold `held` kobo between them.
  function holding(held: string): HouseholdAccount[] {
    return [
      { account_id: BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: `-${held}` },
      { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: held },
      { account_id: RENT, name: "Rent", kind: "pot", balance_kobo: "0" },
    ];
  }

  it("one kobo under the ceiling after adding: done", async () => {
    const db = new FakeDatabase(holding("199999900"));
    assert.deepEqual(await runAddMoney({ amount: "0.99", idempotencyKey: KEY }, db.deps()), { status: "done" });
    assert.equal(db.balance(WALLET), BigInt(199999999));
  });

  it("exactly at the ceiling after adding: done", async () => {
    const db = new FakeDatabase(holding("199999900"));
    assert.deepEqual(await runAddMoney({ amount: "1", idempotencyKey: KEY }, db.deps()), { status: "done" });
    assert.equal(db.balance(WALLET), BigInt(200000000));
  });

  it("one kobo over the ceiling after adding: refused as ceiling, nothing posted", async () => {
    const db = new FakeDatabase(holding("199999900"));
    assert.deepEqual(await runAddMoney({ amount: "1.01", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "ceiling" });
    assert.equal(db.posts.length, 0);
  });

  it("already at the ceiling: even one kobo more is refused", async () => {
    const db = new FakeDatabase(holding("200000000"));
    assert.deepEqual(await runAddMoney({ amount: "0.01", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "ceiling" });
  });

  it("the bank account's balance does not count towards the ceiling", () => {
    const accounts = holding("100");
    accounts[0].balance_kobo = "-999999999999";
    assert.equal(householdTotalKobo(accounts), BigInt(100));
  });

  it("money in pots counts towards the ceiling", () => {
    assert.equal(householdTotalKobo(seedAccounts()), BigInt(10000000));
  });

  it("amounts above 9,007,199,254,740,991 kobo are added exactly", () => {
    const accounts: HouseholdAccount[] = [
      { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "9007199254740993" },
      { account_id: RENT, name: "Rent", kind: "pot", balance_kobo: "9007199254740993" },
    ];
    assert.equal(householdTotalKobo(accounts), BigInt("18014398509481986"));
  });

  it("huge balances that cancel to exactly the ceiling are allowed; one kobo more is not", async () => {
    // Exact arithmetic: 9007199254740993 - 9007199054741093 + 100 = 200,000,000.
    const exact = new FakeDatabase([
      { account_id: BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: "0" },
      { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "9007199254740993" },
      { account_id: RENT, name: "Rent", kind: "pot", balance_kobo: "-9007199054741093" },
    ]);
    assert.deepEqual(await runAddMoney({ amount: "1", idempotencyKey: KEY }, exact.deps()), { status: "done" });

    const over = new FakeDatabase([
      { account_id: BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: "0" },
      { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "9007199254740993" },
      { account_id: RENT, name: "Rent", kind: "pot", balance_kobo: "-9007199054741092" },
    ]);
    assert.deepEqual(await runAddMoney({ amount: "1", idempotencyKey: KEY }, over.deps()), { status: "refused", code: "ceiling" });
  });

  it("ceilingAllows compares as whole kobo", () => {
    assert.equal(ceilingAllows(BigInt(199999999), BigInt(1)), true);
    assert.equal(ceilingAllows(BigInt(199999999), BigInt(2)), false);
    assert.equal(ceilingAllows(BigInt("9007199254740993"), BigInt(1)), false);
  });

  it("the ceiling does not apply to moving money between wallet and pots", async () => {
    const db = new FakeDatabase(holding("200000000"));
    assert.deepEqual(
      await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps()),
      { status: "done" },
    );
  });
});

// ---------------------------------------------------------------------
// The entries
// ---------------------------------------------------------------------

describe("buildEntries", () => {
  for (const kobo of ["1", "99", "100050", "1500000", "100000000"]) {
    it(`${kobo} kobo: two entries that add up to exactly zero, out of "from" and into "to"`, () => {
      const entries = buildEntries(WALLET, RENT, BigInt(kobo));
      assert.equal(entries.length, 2);
      assert.equal(sum(entries), BigInt(0));
      assert.deepEqual(entries[0], { account_id: WALLET, amount_kobo: -Number(kobo) });
      assert.deepEqual(entries[1], { account_id: RENT, amount_kobo: Number(kobo) });
      assert.ok(Number.isSafeInteger(entries[1].amount_kobo));
    });
  }

  const badAmounts: Array<[label: string, kobo: bigint]> = [
    ["zero", BigInt(0)],
    ["negative", BigInt(-1)],
    ["one kobo over the per-move maximum", BigInt(100000001)],
    ["above the largest exact ordinary number", BigInt("9007199254740993")],
  ];

  for (const [label, kobo] of badAmounts) {
    it(`throws loudly for ${label}`, () => {
      assert.throws(() => buildEntries(WALLET, RENT, kobo), /buildEntries refused/);
    });
  }

  it("throws for an ordinary number instead of a bigint", () => {
    assert.throws(() => buildEntries(WALLET, RENT, 100 as unknown as bigint), /buildEntries refused/);
  });

  it("throws for the same account on both sides", () => {
    assert.throws(() => buildEntries(WALLET, WALLET, BigInt(100)), /itself/);
  });

  it("every posted transaction in a run of requests adds up to zero", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    const keys = [KEY, KEY_2, "11111111-2222-4333-8444-555555555555", "66666666-7777-4888-9999-aaaaaaaaaaaa"];
    await runAddMoney({ amount: "250.75", idempotencyKey: keys[0] }, deps);
    await runMoveMoney({ amount: "1,000", fromAccountId: WALLET, toAccountId: GROCERIES, idempotencyKey: keys[1] }, deps);
    await runMoveMoney({ amount: "0.01", fromAccountId: RENT, toAccountId: WALLET, idempotencyKey: keys[2] }, deps);
    await runMoveMoney({ amount: "999.99", fromAccountId: WALLET, toAccountId: SCHOOL, idempotencyKey: keys[3] }, deps);
    assert.equal(db.posts.length, 4);
    for (const request of db.posts) {
      assert.equal(sum(request.entries), BigInt(0));
    }
    // And the household as a whole still adds up to zero.
    assert.equal(
      db.accounts.reduce((total, a) => total + BigInt(a.balance_kobo), BigInt(0)),
      BigInt(0),
    );
  });
});

// ---------------------------------------------------------------------
// Replays and network failures
// ---------------------------------------------------------------------

describe("the same request twice", () => {
  it("addMoney: done the first time, replayed the second, money added once", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps), { status: "done" });
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps), { status: "replayed" });
    assert.equal(db.saved.length, 1);
    assert.equal(db.balance(WALLET), BigInt(1600000));
  });

  it("moveMoney: done the first time, replayed the second, money moved once", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    const input = { amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY };
    assert.deepEqual(await runMoveMoney(input, deps), { status: "done" });
    assert.deepEqual(await runMoveMoney(input, deps), { status: "replayed" });
    assert.equal(db.balance(RENT), BigInt(4100000));
  });

  it("a new key for the same amount is a second, deliberate transfer", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    await runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps);
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY_2 }, deps), { status: "done" });
    assert.equal(db.balance(WALLET), BigInt(1700000));
  });

  it("the same key with a different amount is refused as unknown", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    await runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps);
    assert.deepEqual(await runAddMoney({ amount: "2000", idempotencyKey: KEY }, deps), { status: "refused", code: "unknown" });
    assert.equal(db.balance(WALLET), BigInt(1600000));
  });

  it("an add key and a move key never collide, even with the same UUID", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    await runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps);
    assert.deepEqual(
      await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, deps),
      { status: "done" },
    );
  });
});

describe("no answer from the database", () => {
  it("first attempt lands but its answer is lost; the retry says replayed: result is replayed, money moved once", async () => {
    const db = new FakeDatabase();
    db.script = ["lost", "real"];
    const result = await runAddMoney({ amount: "1000", idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "replayed" });
    assert.equal(db.posts.length, 2);
    assert.equal(db.posts[0].idempotencyKey, db.posts[1].idempotencyKey);
    assert.equal(db.saved.length, 1);
    assert.equal(db.balance(WALLET), BigInt(1600000));
  });

  it("first attempt never arrives; the retry saves it: result is done", async () => {
    const db = new FakeDatabase();
    db.script = ["nothing", "real"];
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY }, db.deps()), { status: "done" });
    assert.equal(db.saved.length, 1);
  });

  it("no answer twice: refused as unknown, and only two attempts are made", async () => {
    const db = new FakeDatabase();
    db.script = ["nothing", "nothing", "real"];
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "unknown" });
    assert.equal(db.posts.length, 2);
    assert.ok(db.logs.some((line) => line.includes("second try")));
  });

  it("a call that throws counts as no answer, and is retried once", async () => {
    const db = new FakeDatabase();
    db.script = ["throw", "real"];
    assert.deepEqual(
      await runMoveMoney({ amount: "1000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps()),
      { status: "done" },
    );
    assert.equal(db.posts.length, 2);
  });

  it("a database refusal is not retried", async () => {
    const db = new FakeDatabase();
    await runMoveMoney({ amount: "999,999", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
    assert.equal(db.posts.length, 1);
  });

  it("reading the accounts fails: refused as unknown, nothing posted, the code and message logged", async () => {
    const db = new FakeDatabase();
    db.loadFails = true;
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY }, db.deps()), { status: "refused", code: "unknown" });
    assert.equal(db.posts.length, 0);
    assert.ok(db.logs.some((line) => line.startsWith("addMoney failed: PGRST000")));
  });

  it("a dependency that throws while reading the accounts is caught", async () => {
    const db = new FakeDatabase();
    const deps = db.deps();
    deps.loadHouseholdAccounts = async () => {
      throw new Error("The server setting SUPABASE_URL is missing.");
    };
    assert.deepEqual(await runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps), { status: "refused", code: "unknown" });
  });
});

// ---------------------------------------------------------------------
// Overdraft
// ---------------------------------------------------------------------

describe("not enough money", () => {
  it("moving more than the wallet holds is refused as not_enough", async () => {
    const db = new FakeDatabase();
    const result = await runMoveMoney({ amount: "20,000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "refused", code: "not_enough" });
    assert.equal(db.balance(WALLET), BigInt(1500000));
  });

  it("moving more than a pot holds is refused as not_enough", async () => {
    const db = new FakeDatabase();
    const result = await runMoveMoney({ amount: "15,000.01", fromAccountId: GROCERIES, toAccountId: WALLET, idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "refused", code: "not_enough" });
  });

  it("moving exactly everything a pot holds is done", async () => {
    const db = new FakeDatabase();
    const result = await runMoveMoney({ amount: "15,000", fromAccountId: GROCERIES, toAccountId: WALLET, idempotencyKey: KEY }, db.deps());
    assert.deepEqual(result, { status: "done" });
    assert.equal(db.balance(GROCERIES), BigInt(0));
  });

  it("the overdraft's code and message are logged", async () => {
    const db = new FakeDatabase();
    await runMoveMoney({ amount: "20,000", fromAccountId: WALLET, toAccountId: RENT, idempotencyKey: KEY }, db.deps());
    assert.ok(db.logs.some((line) => line.startsWith("moveMoney failed: 23514 Not enough money")));
  });
});

// ---------------------------------------------------------------------
// What a result can contain
// ---------------------------------------------------------------------

describe("results never carry error text, account ids or secrets", () => {
  const forbidden = [
    BANK,
    WALLET,
    RENT,
    SCHOOL,
    GROCERIES,
    OTHER_FAMILY_POT,
    KEY,
    "Not enough money",
    "Idempotency key",
    "fetch failed",
    "PGRST",
    "23514",
    SECRET_LOOKING_TEXT,
    "Family Wallet",
  ];

  async function everyKindOfResult(): Promise<MoveResult[]> {
    const results: MoveResult[] = [];
    const run = async (setup: (db: FakeDatabase) => void, call: (deps: MoveDeps) => Promise<MoveResult>) => {
      const db = new FakeDatabase();
      setup(db);
      results.push(await call(db.deps()));
    };
    const move = (amount: string, from: string, to: string) => (deps: MoveDeps) =>
      runMoveMoney({ amount, fromAccountId: from, toAccountId: to, idempotencyKey: KEY }, deps);

    await run(() => {}, (deps) => runAddMoney({ amount: "1000", idempotencyKey: KEY }, deps));
    await run(() => {}, move("20,000", WALLET, RENT));
    await run(() => {}, move("1000", WALLET, OTHER_FAMILY_POT));
    await run((db) => (db.writes = false), move("1000", WALLET, RENT));
    await run((db) => (db.loadFails = true), move("1000", WALLET, RENT));
    await run((db) => (db.script = ["nothing", "nothing"]), move("1000", WALLET, RENT));
    await run((db) => (db.script = ["lost", "real"]), move("1000", WALLET, RENT));
    await run(() => {}, (deps) => runAddMoney({ amount: "abc", idempotencyKey: KEY }, deps));

    const replay = new FakeDatabase();
    await runAddMoney({ amount: "1000", idempotencyKey: KEY }, replay.deps());
    results.push(await runAddMoney({ amount: "2000", idempotencyKey: KEY }, replay.deps()));
    return results;
  }

  it("every result is only a status, plus a code when refused", async () => {
    for (const result of await everyKindOfResult()) {
      const keys = Object.keys(result).sort();
      if (result.status === "refused") {
        assert.deepEqual(keys, ["code", "status"]);
      } else {
        assert.deepEqual(keys, ["status"]);
      }
    }
  });

  it("no result contains an account id, a key, an error message or anything secret-looking", async () => {
    for (const result of await everyKindOfResult()) {
      const text = JSON.stringify(result);
      for (const word of forbidden) {
        assert.ok(!text.includes(word), `${text} should not contain ${word}`);
      }
    }
  });
});
