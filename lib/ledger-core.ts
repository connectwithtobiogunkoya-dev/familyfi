// Reading balances and statements, for one household.
//
// This file holds the rules for reading. It does not talk to the database
// itself: it is handed a reader (below) that does. The real reader is in
// lib/ledger.ts, which is server-only and uses the secret key. Tests hand
// it a stand-in reader, so every rule can be checked without a database.
//
// Every read is for one household, given by the caller. The household id
// and the account id are both checked before anything is asked of the
// database, and every request to the database names the household, so an
// account of another household is simply never found.

import { normaliseAccountId, toStatementLine, type StatementLine } from "./statement.ts";

/** The bank account is never shown, so only these kinds are read. */
export const VISIBLE_KINDS = ["wallet", "pot"] as const;

/** The most lines a statement shows. The newest lines come first. */
export const STATEMENT_LINE_LIMIT = 100;

// Pots appear in this order. A pot with any other name comes after these,
// in alphabetical order.
const POT_ORDER = ["Rent", "School fees", "Groceries"];

// A whole number of kobo as text: an optional minus sign, then digits.
const WHOLE_NUMBER = /^-?[0-9]+$/;

export type AccountBalance = {
  account_id: string;
  name: string;
  kind: "wallet" | "pot";
  // Whole kobo as text, for example "1500000". It is text on purpose, so
  // it is never turned into a floating point number. Give it to
  // formatNaira to display it.
  balance_kobo: string;
};

export type AccountStatement = {
  account: AccountBalance;
  // Newest first. At most STATEMENT_LINE_LIMIT lines.
  lines: StatementLine[];
};

/** What one read gives: rows, or the database's error code and message. */
export type ReadResult<T> = { data: T; error: null } | { data: null; error: { code: string; message: string } };

/**
 * The reads this file needs. Each one is for one household only, and must
 * return only that household's rows: the real reader filters by household
 * in the database, and so must any stand-in.
 */
export type LedgerReader = {
  /** The household's wallet and pots, with balances as text. */
  readBalances: (householdId: string) => Promise<ReadResult<unknown[]>>;
  /** One wallet or pot, only if it belongs to the household; null if not. */
  readAccount: (householdId: string, accountId: string) => Promise<ReadResult<unknown | null>>;
  /** The account's newest statement lines, at most "limit". */
  readStatementLines: (householdId: string, accountId: string, limit: number) => Promise<ReadResult<unknown[]>>;
  /** Writes one line to the server log. */
  logError: (line: string) => void;
};

// Check one row from the database and give it a known shape. Anything
// unexpected is refused, so a wrong value can never reach the screen.
function toAccountBalance(row: unknown): AccountBalance {
  const record = row as Record<string, unknown>;
  const { account_id, name, kind, balance_kobo } = record;

  if (
    typeof account_id !== "string" ||
    typeof name !== "string" ||
    (kind !== "wallet" && kind !== "pot") ||
    typeof balance_kobo !== "string" ||
    !WHOLE_NUMBER.test(balance_kobo)
  ) {
    throw new Error("The database returned a balance in an unexpected form.");
  }

  return { account_id, name, kind, balance_kobo };
}

// Wallet first. Then pots in the fixed order above. Then any other pots by
// name.
function compareAccounts(a: AccountBalance, b: AccountBalance): number {
  if (a.kind !== b.kind) {
    return a.kind === "wallet" ? -1 : 1;
  }

  const aPosition = POT_ORDER.indexOf(a.name);
  const bPosition = POT_ORDER.indexOf(b.name);
  const aRank = aPosition === -1 ? POT_ORDER.length : aPosition;
  const bRank = bPosition === -1 ? POT_ORDER.length : bPosition;

  if (aRank !== bRank) {
    return aRank - bRank;
  }
  return a.name.localeCompare(b.name);
}

/**
 * The household's wallet and pots with their balances, the wallet first.
 *
 * The household id is checked first, with the same strictness as an
 * account id. One that is not a properly formed UUID gives an empty list,
 * without asking the database anything. Read only: it writes nothing.
 */
export async function readHouseholdBalances(householdId: unknown, reader: LedgerReader): Promise<AccountBalance[]> {
  const household = normaliseAccountId(householdId);
  if (household === null) {
    return [];
  }

  const { data, error } = await reader.readBalances(household);

  if (error) {
    // Only the error's code and message go to the server log: never the
    // key, the address or the whole error object. Visitors cannot see this
    // log.
    reader.logError(`getHouseholdBalances failed: ${error.code} ${error.message}`);
    // The raw error is deliberately not included: it can contain details
    // of the database that should not reach a visitor's screen.
    throw new Error("Could not read the balances from the database.");
  }

  const rows: unknown[] = data ?? [];
  return rows.map(toAccountBalance).sort(compareAccounts);
}

/**
 * One account's statement: the account with its current balance, and its
 * newest lines.
 *
 * It only serves the given household's wallet and pots. For anything else
 * it returns null, and does not say why: a household id or account id that
 * is badly formed, an account that does not exist, one that belongs to
 * another household, or the bank account.
 *
 * Both ids are checked before anything is asked of the database. The
 * account is then looked up for this household only. If it is not found,
 * nothing more is asked: no second request is made that could reveal
 * anything about another household. Read only: it writes nothing.
 */
export async function readAccountStatement(
  householdId: unknown,
  accountId: unknown,
  reader: LedgerReader,
): Promise<AccountStatement | null> {
  const household = normaliseAccountId(householdId);
  const id = normaliseAccountId(accountId);
  if (household === null || id === null) {
    return null;
  }

  // 1. The account itself, but only if it is this household's wallet or
  //    one of its pots.
  const { data: accountRow, error: accountError } = await reader.readAccount(household, id);

  if (accountError) {
    reader.logError(`getAccountStatement failed: ${accountError.code} ${accountError.message}`);
    throw new Error("Could not read the statement from the database.");
  }

  if (accountRow === null || accountRow === undefined) {
    return null;
  }

  const account = toAccountBalance(accountRow);

  // 2. Its newest lines, ordered by seq, the entry counter. Never by time
  //    or id. Asked for this household again, as a second check.
  const { data: lineRows, error: linesError } = await reader.readStatementLines(household, id, STATEMENT_LINE_LIMIT);

  if (linesError) {
    reader.logError(`getAccountStatement failed: ${linesError.code} ${linesError.message}`);
    throw new Error("Could not read the statement from the database.");
  }

  const rows: unknown[] = lineRows ?? [];
  return { account, lines: rows.map(toStatementLine) };
}
