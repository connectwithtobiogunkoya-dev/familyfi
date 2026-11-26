// The ledger reader for FamilyFi.
//
// This is the only file that talks to the database, and the only file
// that touches the secret key. It can do exactly one thing: read the
// balances of the demo family's wallet and pots.
//
// The line below makes the build fail if this file is ever pulled into
// code that runs in a visitor's browser. The secret key must stay on the
// server.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import { normaliseAccountId, toStatementLine, type StatementLine } from "./statement.ts";

// The seeded demo family, "The Adeyemi Family" (see supabase/seed.sql).
// It is fixed here on purpose: nothing a visitor sends can change which
// household is read.
const DEMO_HOUSEHOLD_ID = "a0000000-0000-4000-8000-000000000001";

// The fake bank account is never shown, so only these kinds are read.
const VISIBLE_KINDS = ["wallet", "pot"] as const;

// Pots appear in this order. A pot with any other name comes after
// these, in alphabetical order.
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

// Read one setting from the server's environment. If it is missing, say
// which one by name. The value itself is never put in a message.
function requireSetting(name: "SUPABASE_URL" | "SUPABASE_SECRET_KEY"): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `The server setting ${name} is missing. Add it to .env.local on your computer, or to the project's Environment Variables on Vercel.`,
    );
  }
  return value.trim();
}

/**
 * Read the balances of the demo family's wallet and pots.
 *
 * Takes no arguments, reads one view for one fixed household, and writes
 * nothing. Returns the wallet first, then the pots.
 */
export async function getHouseholdBalances(): Promise<AccountBalance[]> {
  const supabase = createClient(
    requireSetting("SUPABASE_URL"),
    requireSetting("SUPABASE_SECRET_KEY"),
    {
      // This is server code with no signed-in user, so nothing about a
      // login session is saved, refreshed or read from a web address.
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  // "balance_kobo::text" asks the database to send the balance as text.
  const { data, error } = await supabase
    .from("account_balances")
    .select("account_id, name, kind, balance_kobo::text")
    .eq("household_id", DEMO_HOUSEHOLD_ID)
    .in("kind", [...VISIBLE_KINDS]);

  if (error) {
    // Write the reason to the server's own log, so the owner can find out
    // what went wrong. Only the error's code and message are logged: never
    // the key, the address or the whole error object. Visitors cannot see
    // this log.
    console.error(`getHouseholdBalances failed: ${error.code} ${error.message}`);

    // The raw error is deliberately not included: it can contain details
    // of the database that should not reach a visitor's screen.
    throw new Error("Could not read the balances from the database.");
  }

  const rows: unknown[] = data ?? [];
  const balances = rows.map(toAccountBalance);

  return balances.sort(compareAccounts);
}

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

// Wallet first. Then pots in the fixed order above. Then any other pots
// by name.
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

// ---------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------

// The most lines a statement shows. The newest lines come first.
export const STATEMENT_LINE_LIMIT = 100;

export type AccountStatement = {
  account: AccountBalance;
  // Newest first. At most STATEMENT_LINE_LIMIT lines.
  lines: StatementLine[];
};

/**
 * Read one account's statement: the account with its current balance,
 * and its newest lines.
 *
 * It only serves the demo family's wallet and pots. For anything else it
 * returns null, and does not say why: an id that is badly formed, that
 * does not exist, that belongs to another household, or that is the bank
 * account. Read only: it writes nothing.
 */
export async function getAccountStatement(accountId: unknown): Promise<AccountStatement | null> {
  // Check the id before anything is sent to the database.
  const id = normaliseAccountId(accountId);
  if (id === null) {
    return null;
  }

  const supabase = createClient(
    requireSetting("SUPABASE_URL"),
    requireSetting("SUPABASE_SECRET_KEY"),
    {
      // Server code with no signed-in user: no login session is saved,
      // refreshed or read from a web address.
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  // 1. The account itself, but only if it is the demo family's wallet or
  //    one of its pots. The bank account is a different kind, so it is
  //    never found here.
  const { data: accountRow, error: accountError } = await supabase
    .from("account_balances")
    .select("account_id, name, kind, balance_kobo::text")
    .eq("account_id", id)
    .eq("household_id", DEMO_HOUSEHOLD_ID)
    .in("kind", [...VISIBLE_KINDS])
    .maybeSingle();

  if (accountError) {
    // Only the error's code and message go to the server log: never the
    // key, the address or the whole error object.
    console.error(`getAccountStatement failed: ${accountError.code} ${accountError.message}`);
    throw new Error("Could not read the statement from the database.");
  }

  if (accountRow === null) {
    return null;
  }

  const account = toAccountBalance(accountRow);

  // 2. Its newest lines, ordered by seq, the entry counter. Never by time
  //    or id. seq is only used for ordering and is not sent back.
  const { data: lineRows, error: linesError } = await supabase
    .from("account_statements")
    .select("description, created_at, amount_kobo::text, balance_after_kobo::text")
    .eq("account_id", id)
    .eq("household_id", DEMO_HOUSEHOLD_ID)
    .order("seq", { ascending: false })
    .limit(STATEMENT_LINE_LIMIT);

  if (linesError) {
    console.error(`getAccountStatement failed: ${linesError.code} ${linesError.message}`);
    throw new Error("Could not read the statement from the database.");
  }

  const rows: unknown[] = lineRows ?? [];

  return { account, lines: rows.map(toStatementLine) };
}
