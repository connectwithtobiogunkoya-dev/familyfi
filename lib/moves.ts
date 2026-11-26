// Adding and moving money in FamilyFi: the server-only front door.
//
// addMoney and moveMoney are the only two functions the rest of the app
// should call to move money. All the rules live in lib/moves-core.ts.
// This file plugs the real database into those rules, through the secret
// key, and so must never reach a visitor's browser.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  runAddMoney,
  runMoveMoney,
  type AddMoneyInput,
  type HouseholdAccount,
  type LoadOutcome,
  type MoveDeps,
  type MoveMoneyInput,
  type MoveResult,
  type PostOutcome,
  type PostRequest,
} from "./moves-core.ts";
import { writesEnabled } from "./settings.ts";

// The seeded demo family. The same id is fixed in lib/ledger.ts. Nothing a
// visitor sends can change which household is used.
const DEMO_HOUSEHOLD_ID = "a0000000-0000-4000-8000-000000000001";

// How long to wait for the database before treating it as no answer.
const DATABASE_TIMEOUT_MS = 10000;

const KINDS = ["wallet", "pot", "bank_source"];

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
    // Server code with no signed-in user: no login session is saved,
    // refreshed or read from a web address.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// One account row from the database, checked before it is trusted.
function toHouseholdAccount(row: unknown): HouseholdAccount | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const { account_id, name, kind, balance_kobo } = row as Record<string, unknown>;
  if (
    typeof account_id !== "string" ||
    typeof name !== "string" ||
    typeof kind !== "string" ||
    !KINDS.includes(kind) ||
    typeof balance_kobo !== "string" ||
    !/^-?[0-9]+$/.test(balance_kobo)
  ) {
    return null;
  }
  return { account_id, name, kind: kind as HouseholdAccount["kind"], balance_kobo };
}

const realDeps: MoveDeps = {
  writesEnabled,

  // Every account of the demo household, the bank included, with its
  // balance from the entries, sent as text.
  async loadHouseholdAccounts(): Promise<LoadOutcome> {
    const { data, error } = await connect()
      .from("account_balances")
      .select("account_id, name, kind, balance_kobo::text")
      .eq("household_id", DEMO_HOUSEHOLD_ID)
      .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));

    if (error) {
      return { kind: "failed", code: error.code || "no_code", message: error.message };
    }

    const accounts: HouseholdAccount[] = [];
    for (const row of (data ?? []) as unknown[]) {
      const account = toHouseholdAccount(row);
      if (account === null) {
        return { kind: "failed", code: "bad_row", message: "An account row was not in the expected form." };
      }
      accounts.push(account);
    }
    return { kind: "loaded", accounts };
  },

  // Call post_transaction. The entries go as JSON, with each amount as a
  // JSON whole number, which is what post_transaction checks for.
  async postTransaction(request: PostRequest): Promise<PostOutcome> {
    const { data, error, status } = await connect()
      .rpc("post_transaction", {
        p_household_id: DEMO_HOUSEHOLD_ID,
        p_description: request.description,
        p_idempotency_key: request.idempotencyKey,
        p_entries: request.entries,
      })
      .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));

    if (error) {
      // The Supabase library reports a network failure or a timeout as
      // status 0 with no error code. A server error with no code also
      // means the database itself never answered.
      if (status === 0 || (status >= 500 && !error.code)) {
        return { kind: "no_answer", message: error.message };
      }
      return { kind: "database_error", code: error.code || "no_code", message: error.message };
    }

    const answer = data as { transaction_id?: unknown; replayed?: unknown } | null;
    if (answer === null || typeof answer.transaction_id !== "string" || typeof answer.replayed !== "boolean") {
      // The database answered, but not in the expected shape. It is not
      // safe to say whether anything was saved, so this is refused.
      return { kind: "database_error", code: "bad_answer", message: "post_transaction gave an answer in an unexpected form." };
    }
    return { kind: "posted", replayed: answer.replayed };
  },

  logError(line: string): void {
    console.error(line);
  },
};

/** Add money from the household's bank account into its wallet. */
export async function addMoney(input: AddMoneyInput): Promise<MoveResult> {
  return runAddMoney(input, realDeps);
}

/** Move money from the wallet to a pot, or from a pot to the wallet. */
export async function moveMoney(input: MoveMoneyInput): Promise<MoveResult> {
  return runMoveMoney(input, realDeps);
}
