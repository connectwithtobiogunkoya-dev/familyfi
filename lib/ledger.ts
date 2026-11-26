// The ledger reader for FamilyFi: the server-only front door.
//
// getHouseholdBalances and getAccountStatement read balances and
// statements for one household, given by the caller. The rules live in
// lib/ledger-core.ts. This file plugs the real database into those rules,
// through the secret key.
//
// The line below makes the build fail if this file is ever pulled into
// code that runs in a visitor's browser. The secret key must stay on the
// server.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  STATEMENT_LINE_LIMIT,
  VISIBLE_KINDS,
  readAccountStatement,
  readHouseholdBalances,
  type AccountBalance,
  type AccountStatement,
  type LedgerReader,
} from "./ledger-core.ts";

export { STATEMENT_LINE_LIMIT };
export type { AccountBalance, AccountStatement };

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

function connect() {
  return createClient(requireSetting("SUPABASE_URL"), requireSetting("SUPABASE_SECRET_KEY"), {
    // This is server code with no signed-in user, so nothing about a login
    // session is saved, refreshed or read from a web address.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// The real reads. Every one of them names the household in the database
// request itself, so only that household's rows can ever come back.
const realReader: LedgerReader = {
  async readBalances(householdId) {
    // "balance_kobo::text" asks the database to send the balance as text.
    const { data, error } = await connect()
      .from("account_balances")
      .select("account_id, name, kind, balance_kobo::text")
      .eq("household_id", householdId)
      .in("kind", [...VISIBLE_KINDS]);
    return error ? { data: null, error: { code: error.code, message: error.message } } : { data: data ?? [], error: null };
  },

  async readAccount(householdId, accountId) {
    // The bank account is a different kind, so it is never found here.
    const { data, error } = await connect()
      .from("account_balances")
      .select("account_id, name, kind, balance_kobo::text")
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .in("kind", [...VISIBLE_KINDS])
      .maybeSingle();
    return error ? { data: null, error: { code: error.code, message: error.message } } : { data: data ?? null, error: null };
  },

  async readStatementLines(householdId, accountId, limit) {
    // Ordered by seq, the entry counter. seq is only used for ordering and
    // is not sent back.
    const { data, error } = await connect()
      .from("account_statements")
      .select("description, created_at, amount_kobo::text, balance_after_kobo::text")
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .order("seq", { ascending: false })
      .limit(limit);
    return error ? { data: null, error: { code: error.code, message: error.message } } : { data: data ?? [], error: null };
  },

  logError(line) {
    console.error(line);
  },
};

/**
 * Read the household's wallet and pots with their balances, the wallet
 * first. Read only: it writes nothing.
 */
export async function getHouseholdBalances(householdId: string): Promise<AccountBalance[]> {
  return readHouseholdBalances(householdId, realReader);
}

/**
 * Read one account's statement, only if it is this household's wallet or
 * one of its pots; otherwise null. Read only: it writes nothing.
 */
export async function getAccountStatement(householdId: string, accountId: unknown): Promise<AccountStatement | null> {
  return readAccountStatement(householdId, accountId, realReader);
}
