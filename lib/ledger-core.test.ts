// Tests for reading balances and statements, one household at a time.
//
// Run with:  npm test
//
// These use a stand-in reader (StandInReader below) instead of the real
// database. Like the real one, it answers each read for the household it
// is asked about, and it records every read and what came back, so the
// tests can prove that nothing of another household was ever returned.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STATEMENT_LINE_LIMIT, readAccountStatement, readHouseholdBalances, type LedgerReader, type ReadResult } from "./ledger-core.ts";

const HOUSEHOLD_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const HOUSEHOLD_B = "bbbbbbbb-0000-4000-8000-00000000000b";

const A_BANK = "ca000000-0000-4000-8000-000000000001";
const A_WALLET = "ca000000-0000-4000-8000-000000000002";
const A_RENT = "ca000000-0000-4000-8000-000000000003";
const A_GROCERIES = "ca000000-0000-4000-8000-000000000004";
const B_WALLET = "cb000000-0000-4000-8000-000000000002";
const B_RENT = "cb000000-0000-4000-8000-000000000003";

type AccountRow = { household_id: string; account_id: string; name: string; kind: string; balance_kobo: string };
type LineRow = { household_id: string; account_id: string; description: string; created_at: string; amount_kobo: string; balance_after_kobo: string };

const ACCOUNTS: AccountRow[] = [
  { household_id: HOUSEHOLD_A, account_id: A_BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: "-5000000" },
  { household_id: HOUSEHOLD_A, account_id: A_GROCERIES, name: "Groceries", kind: "pot", balance_kobo: "500000" },
  { household_id: HOUSEHOLD_A, account_id: A_WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "3000000" },
  { household_id: HOUSEHOLD_A, account_id: A_RENT, name: "Rent", kind: "pot", balance_kobo: "1500000" },
  { household_id: HOUSEHOLD_B, account_id: B_WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "7700000" },
  { household_id: HOUSEHOLD_B, account_id: B_RENT, name: "Rent", kind: "pot", balance_kobo: "2200000" },
];

const LINES: LineRow[] = [
  { household_id: HOUSEHOLD_A, account_id: A_WALLET, description: "Add money to the wallet", created_at: "2026-11-26T10:00:00+00:00", amount_kobo: "5000000", balance_after_kobo: "5000000" },
  { household_id: HOUSEHOLD_A, account_id: A_WALLET, description: "Move money from Family Wallet to Rent", created_at: "2026-11-26T11:00:00+00:00", amount_kobo: "-2000000", balance_after_kobo: "3000000" },
  { household_id: HOUSEHOLD_B, account_id: B_WALLET, description: "Add money to the wallet", created_at: "2026-11-26T12:00:00+00:00", amount_kobo: "7700000", balance_after_kobo: "7700000" },
];

type ReadRecord = { read: string; householdId: string; accountId?: string; returnedAccountIds: string[] };

// The stand-in reader. It filters every read by the household it is
// given, exactly as the real database request does, and records it all.
class StandInReader implements LedgerReader {
  reads: ReadRecord[] = [];
  logs: string[] = [];
  failWith: { code: string; message: string } | null = null;

  private visible(row: AccountRow): boolean {
    return row.kind === "wallet" || row.kind === "pot";
  }

  private strip(row: AccountRow) {
    return { account_id: row.account_id, name: row.name, kind: row.kind, balance_kobo: row.balance_kobo };
  }

  readBalances = async (householdId: string): Promise<ReadResult<unknown[]>> => {
    if (this.failWith) {
      return { data: null, error: this.failWith };
    }
    const rows = ACCOUNTS.filter((r) => r.household_id === householdId && this.visible(r));
    this.reads.push({ read: "balances", householdId, returnedAccountIds: rows.map((r) => r.account_id) });
    return { data: rows.map((r) => this.strip(r)), error: null };
  };

  readAccount = async (householdId: string, accountId: string): Promise<ReadResult<unknown | null>> => {
    if (this.failWith) {
      return { data: null, error: this.failWith };
    }
    const row = ACCOUNTS.find((r) => r.household_id === householdId && r.account_id === accountId && this.visible(r));
    this.reads.push({ read: "account", householdId, accountId, returnedAccountIds: row ? [row.account_id] : [] });
    return { data: row ? this.strip(row) : null, error: null };
  };

  readStatementLines = async (householdId: string, accountId: string, limit: number): Promise<ReadResult<unknown[]>> => {
    const rows = LINES.filter((r) => r.household_id === householdId && r.account_id === accountId)
      .slice()
      .reverse()
      .slice(0, limit);
    this.reads.push({ read: "lines", householdId, accountId, returnedAccountIds: rows.map((r) => r.account_id) });
    return {
      data: rows.map((r) => ({ description: r.description, created_at: r.created_at, amount_kobo: r.amount_kobo, balance_after_kobo: r.balance_after_kobo })),
      error: null,
    };
  };

  logError = (line: string): void => {
    this.logs.push(line);
  };

  // Every account id any read has returned so far.
  allReturnedAccountIds(): string[] {
    return this.reads.flatMap((r) => r.returnedAccountIds);
  }
}

const B_ACCOUNT_IDS = ACCOUNTS.filter((r) => r.household_id === HOUSEHOLD_B).map((r) => r.account_id);

describe("readHouseholdBalances", () => {
  it("A's balances are A's wallet and pots, the wallet first, without the bank", async () => {
    const reader = new StandInReader();
    const balances = await readHouseholdBalances(HOUSEHOLD_A, reader);
    assert.deepEqual(
      balances.map((b) => [b.name, b.balance_kobo]),
      [
        ["Family Wallet", "3000000"],
        ["Rent", "1500000"],
        ["Groceries", "500000"],
      ],
    );
  });

  it("A's balances never contain a row of B's", async () => {
    const reader = new StandInReader();
    const balances = await readHouseholdBalances(HOUSEHOLD_A, reader);
    for (const balance of balances) {
      assert.ok(!B_ACCOUNT_IDS.includes(balance.account_id));
    }
    for (const id of reader.allReturnedAccountIds()) {
      assert.ok(!B_ACCOUNT_IDS.includes(id));
    }
  });

  it("asks the database for household A only", async () => {
    const reader = new StandInReader();
    await readHouseholdBalances(HOUSEHOLD_A, reader);
    assert.deepEqual(reader.reads.map((r) => r.householdId), [HOUSEHOLD_A]);
  });

  it("B's balances are B's own", async () => {
    const reader = new StandInReader();
    const balances = await readHouseholdBalances(HOUSEHOLD_B, reader);
    assert.deepEqual(balances.map((b) => b.account_id), [B_WALLET, B_RENT]);
  });

  it("a household id in capitals is read as the same household", async () => {
    const reader = new StandInReader();
    const balances = await readHouseholdBalances(HOUSEHOLD_A.toUpperCase(), reader);
    assert.equal(balances.length, 3);
    assert.deepEqual(reader.reads.map((r) => r.householdId), [HOUSEHOLD_A]);
  });

  const badIds: Array<[label: string, value: unknown]> = [
    ["an empty string", ""],
    ["a word", "household"],
    ["a UUID with an extra character", `${HOUSEHOLD_A}0`],
    ["SQL-looking text", "' or 1=1 --"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
  ];

  for (const [label, value] of badIds) {
    it(`a household id that is ${label} gives an empty list, without asking the database`, async () => {
      const reader = new StandInReader();
      assert.deepEqual(await readHouseholdBalances(value, reader), []);
      assert.equal(reader.reads.length, 0);
    });
  }

  it("a database error is logged as code and message, and the caller gets a plain sentence", async () => {
    const reader = new StandInReader();
    reader.failWith = { code: "PGRST301", message: "permission denied" };
    await assert.rejects(readHouseholdBalances(HOUSEHOLD_A, reader), /^Error: Could not read the balances from the database\.$/);
    assert.deepEqual(reader.logs, ["getHouseholdBalances failed: PGRST301 permission denied"]);
  });
});

describe("readAccountStatement", () => {
  it("A's wallet statement has A's lines, newest first", async () => {
    const reader = new StandInReader();
    const statement = await readAccountStatement(HOUSEHOLD_A, A_WALLET, reader);
    assert.ok(statement !== null);
    assert.equal(statement.account.account_id, A_WALLET);
    assert.equal(statement.account.balance_kobo, "3000000");
    assert.deepEqual(statement.lines.map((l) => l.amount_kobo), ["-2000000", "5000000"]);
  });

  it("asks for the lines of household A, and at most the line limit", async () => {
    const reader = new StandInReader();
    await readAccountStatement(HOUSEHOLD_A, A_WALLET, reader);
    assert.deepEqual(
      reader.reads.map((r) => [r.read, r.householdId]),
      [
        ["account", HOUSEHOLD_A],
        ["lines", HOUSEHOLD_A],
      ],
    );
    assert.equal(STATEMENT_LINE_LIMIT, 100);
  });

  it("with household A, an account of household B is not found, and no read returned any of B's rows", async () => {
    const reader = new StandInReader();
    assert.equal(await readAccountStatement(HOUSEHOLD_A, B_WALLET, reader), null);
    // One read only: the account, for household A, which found nothing.
    assert.deepEqual(reader.reads, [{ read: "account", householdId: HOUSEHOLD_A, accountId: B_WALLET, returnedAccountIds: [] }]);
    for (const id of reader.allReturnedAccountIds()) {
      assert.ok(!B_ACCOUNT_IDS.includes(id));
    }
  });

  it("with household A, B's pot is not found either", async () => {
    const reader = new StandInReader();
    assert.equal(await readAccountStatement(HOUSEHOLD_A, B_RENT, reader), null);
    assert.equal(reader.reads.filter((r) => r.read === "lines").length, 0);
  });

  it("not found for another household looks exactly like not found for an account that does not exist", async () => {
    const reader = new StandInReader();
    const otherHousehold = await readAccountStatement(HOUSEHOLD_A, B_WALLET, reader);
    const nowhere = await readAccountStatement(HOUSEHOLD_A, "eeeeeeee-0000-4000-8000-000000000000", reader);
    assert.equal(otherHousehold, null);
    assert.equal(nowhere, null);
  });

  it("the bank account is not found", async () => {
    const reader = new StandInReader();
    assert.equal(await readAccountStatement(HOUSEHOLD_A, A_BANK, reader), null);
  });

  it("A's wallet asked for under household B is not found", async () => {
    const reader = new StandInReader();
    assert.equal(await readAccountStatement(HOUSEHOLD_B, A_WALLET, reader), null);
  });

  const badIds: Array<[label: string, value: unknown]> = [
    ["an empty string", ""],
    ["a word", "household"],
    ["a UUID with a trailing line break", `${HOUSEHOLD_A}\n`],
    ["null", null],
    ["a number", 7],
  ];

  for (const [label, value] of badIds) {
    it(`a household id that is ${label} is not found, without asking the database`, async () => {
      const reader = new StandInReader();
      assert.equal(await readAccountStatement(value, A_WALLET, reader), null);
      assert.equal(reader.reads.length, 0);
    });

    it(`an account id that is ${label} is not found, without asking the database`, async () => {
      const reader = new StandInReader();
      assert.equal(await readAccountStatement(HOUSEHOLD_A, value, reader), null);
      assert.equal(reader.reads.length, 0);
    });
  }

  it("a database error is logged as code and message, and the caller gets a plain sentence", async () => {
    const reader = new StandInReader();
    reader.failWith = { code: "42P01", message: "relation does not exist" };
    await assert.rejects(readAccountStatement(HOUSEHOLD_A, A_WALLET, reader), /^Error: Could not read the statement from the database\.$/);
    assert.deepEqual(reader.logs, ["getAccountStatement failed: 42P01 relation does not exist"]);
  });
});
