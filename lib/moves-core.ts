// The rules for moving money in FamilyFi.
//
// This file decides whether a request to add or move money is allowed,
// builds the two ledger entries, and asks the database to post them. It
// does not talk to the database itself: the caller hands it the ways to
// do that (the "deps" below). The real ones live in lib/moves.ts, which
// is server-only. Tests hand it stand-ins instead, so every rule can be
// checked without a database.
//
// Every check happens here, in this order, because a server action can
// be called directly without going through any screen:
//   a. the kill switch
//   b. the idempotency key
//   c. the typed amount
//   d. the account ids, looked up in the one household the site uses
//   e. which accounts money may move between
//   f. the household ceiling (Add money only)
//
// Nothing here ever throws to the caller. Every outcome is a result:
// done, replayed, or refused with one code from lib/errors.ts.

import { MAX_AMOUNT_KOBO, parseNairaToKobo } from "./amount.ts";
import { toErrorCode, type ErrorCode } from "./errors.ts";
import { normaliseAccountId } from "./statement.ts";

/**
 * The most a household's wallet and pots may hold together:
 * 200,000,000 kobo = ₦2,000,000. Add money is refused if it would take
 * the total over this. (From amendment 2 of the approved Slice 4 plan.)
 */
export const HOUSEHOLD_CEILING_KOBO = BigInt(200000000);

const ZERO = BigInt(0);
const LARGEST_SAFE_KOBO = BigInt(Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------

/** What every request ends with. No message, no account id, nothing else. */
export type MoveResult = { status: "done" } | { status: "replayed" } | { status: "refused"; code: ErrorCode };

/** One account of the household, as read from the database. */
export type HouseholdAccount = {
  account_id: string;
  name: string;
  kind: "wallet" | "pot" | "bank_source";
  // Whole kobo as text.
  balance_kobo: string;
};

/** One entry as post_transaction_by expects it: a JSON whole number of kobo. */
export type LedgerEntry = { account_id: string; amount_kobo: number };

export type PostRequest = {
  // The household the transaction belongs to: always the one the caller
  // gave runAddMoney or runMoveMoney, never one from the form.
  householdId: string;
  // The member making it: always the one the caller gave, from the same
  // session, never one from the form. post_transaction_by checks they are
  // a member of the household.
  createdBy: string;
  description: string;
  idempotencyKey: string;
  entries: LedgerEntry[];
};

/** What reading the household's accounts can give. */
export type LoadOutcome =
  | { kind: "loaded"; accounts: HouseholdAccount[] }
  | { kind: "failed"; code: string; message: string };

/** What one call to post_transaction_by can give. */
export type PostOutcome =
  // The database answered and the transaction is saved: either just now,
  // or earlier under the same key (replayed).
  | { kind: "posted"; replayed: boolean }
  // The database answered and refused.
  | { kind: "database_error"; code: string; message: string }
  // No answer at all (a network failure or a timeout). The transaction
  // may or may not have been saved.
  | { kind: "no_answer"; message: string };

/** The ways this file reaches the outside world. */
export type MoveDeps = {
  writesEnabled: () => boolean;
  // Every account of this one household, the bank included. Must return
  // only that household's accounts.
  loadHouseholdAccounts: (householdId: string) => Promise<LoadOutcome>;
  postTransaction: (request: PostRequest) => Promise<PostOutcome>;
  logError: (line: string) => void;
};

export type AddMoneyInput = {
  amount: unknown;
  idempotencyKey: unknown;
};

export type MoveMoneyInput = {
  amount: unknown;
  fromAccountId: unknown;
  toAccountId: unknown;
  idempotencyKey: unknown;
};

const DONE: MoveResult = { status: "done" };
const REPLAYED: MoveResult = { status: "replayed" };

function refused(code: ErrorCode): MoveResult {
  return { status: "refused", code };
}

// A short description of something that went wrong, for the server log.
// It is only ever used for problems raised by this app's own code or the
// network, never to show anything to a visitor.
function describeProblem(problem: unknown): string {
  return problem instanceof Error ? problem.message : "an unexpected problem";
}

// ---------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------

/**
 * Check the idempotency key from the form and give the key sent to the
 * database: "add-<uuid>" or "move-<uuid>", lowercase. Anything that is not
 * a properly formed UUID gives null.
 */
export function databaseKey(prefix: "add" | "move", value: unknown): string | null {
  const uuid = normaliseAccountId(value);
  return uuid === null ? null : `${prefix}-${uuid}`;
}

/** Money may only move from the wallet to a pot, or from a pot to the wallet. */
export function isAllowedMove(fromKind: HouseholdAccount["kind"], toKind: HouseholdAccount["kind"]): boolean {
  return (fromKind === "wallet" && toKind === "pot") || (fromKind === "pot" && toKind === "wallet");
}

/** What the household's wallet and pots hold together, as exact whole kobo. */
export function householdTotalKobo(accounts: HouseholdAccount[]): bigint {
  let total = ZERO;
  for (const account of accounts) {
    if (account.kind === "wallet" || account.kind === "pot") {
      total += BigInt(account.balance_kobo);
    }
  }
  return total;
}

/** Would adding this amount keep the household at or under the ceiling? */
export function ceilingAllows(totalKobo: bigint, amountKobo: bigint): boolean {
  return totalKobo + amountKobo <= HOUSEHOLD_CEILING_KOBO;
}

/**
 * Build the two entries for moving an amount from one account to another.
 * Money leaves "from" as a negative and arrives in "to" as a positive, so
 * the two always add up to exactly zero.
 *
 * post_transaction_by needs each amount as a JSON whole number, so the bigint
 * is turned into an ordinary number here. That is only exact up to
 * 9,007,199,254,740,991, so the amount is checked first: it must be more
 * than zero and at most 100,000,000 kobo. Anything else throws loudly,
 * because it means a check earlier on has failed.
 */
export function buildEntries(fromAccountId: string, toAccountId: string, amountKobo: bigint): LedgerEntry[] {
  if (typeof amountKobo !== "bigint" || amountKobo <= ZERO || amountKobo > MAX_AMOUNT_KOBO || amountKobo > LARGEST_SAFE_KOBO) {
    throw new Error(`buildEntries refused an amount outside 1 to ${MAX_AMOUNT_KOBO} kobo.`);
  }
  if (fromAccountId === toAccountId) {
    throw new Error("buildEntries refused to move money from an account to itself.");
  }

  const amount = Number(amountKobo);
  if (!Number.isSafeInteger(amount) || BigInt(amount) !== amountKobo) {
    throw new Error("buildEntries could not turn the amount into an exact whole number.");
  }

  return [
    { account_id: fromAccountId, amount_kobo: -amount },
    { account_id: toAccountId, amount_kobo: amount },
  ];
}

// ---------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------

function readAmount(amount: unknown): bigint | MoveResult {
  try {
    return parseNairaToKobo(amount as string);
  } catch (problem) {
    // An AmountError becomes bad_amount or too_large. Anything else
    // becomes unknown.
    return refused(toErrorCode(problem));
  }
}

async function loadAccounts(deps: MoveDeps, householdId: string, label: string): Promise<HouseholdAccount[] | null> {
  let outcome: LoadOutcome;
  try {
    outcome = await deps.loadHouseholdAccounts(householdId);
  } catch (problem) {
    deps.logError(`${label} failed: could not read the accounts: ${describeProblem(problem)}`);
    return null;
  }
  if (outcome.kind === "failed") {
    deps.logError(`${label} failed: ${outcome.code} ${outcome.message}`);
    return null;
  }
  return outcome.accounts;
}

async function attemptPost(deps: MoveDeps, request: PostRequest): Promise<PostOutcome> {
  try {
    return await deps.postTransaction(request);
  } catch (problem) {
    // A thrown error from the call itself means no answer came back.
    return { kind: "no_answer", message: describeProblem(problem) };
  }
}

// Post the entries. If no answer comes back at all, try exactly once more
// with the same key: if the first attempt did land, the database answers
// "replayed" and nothing moves twice.
async function post(deps: MoveDeps, label: string, request: PostRequest): Promise<MoveResult> {
  const first = await attemptPost(deps, request);

  if (first.kind === "posted") {
    return first.replayed ? REPLAYED : DONE;
  }
  if (first.kind === "database_error") {
    deps.logError(`${label} failed: ${first.code} ${first.message}`);
    return refused(toErrorCode({ code: first.code, message: first.message }));
  }

  deps.logError(`${label}: no answer from the database (${first.message}). Trying once more with the same key.`);
  const second = await attemptPost(deps, request);

  if (second.kind === "posted") {
    return second.replayed ? REPLAYED : DONE;
  }
  if (second.kind === "database_error") {
    deps.logError(`${label} failed on the second try: ${second.code} ${second.message}`);
    return refused(toErrorCode({ code: second.code, message: second.message }));
  }

  deps.logError(`${label} failed: no answer from the database on the second try either (${second.message}).`);
  return refused("unknown");
}

// ---------------------------------------------------------------------
// Add money: from the household's bank account into its wallet
// ---------------------------------------------------------------------

// householdId and createdBy are supplied by the caller: the signed-in
// person's own household and their own id, from their session on the
// server. Neither is ever read from the form: the input object has no
// household or person in it, and any extra field the form sends is ignored.
export async function runAddMoney(householdId: unknown, createdBy: unknown, input: AddMoneyInput, deps: MoveDeps): Promise<MoveResult> {
  try {
    // a. The kill switch, before anything else.
    if (!deps.writesEnabled()) {
      return refused("writes_off");
    }

    //    The household: a properly formed UUID, or nothing is done. A bad
    //    one is a mistake in the app, so it is "unknown", and the database
    //    is not asked anything.
    const household = normaliseAccountId(householdId);
    if (household === null) {
      return refused("unknown");
    }

    //    The person making it: a properly formed UUID too, or nothing is
    //    done and the database is not asked anything.
    const person = normaliseAccountId(createdBy);
    if (person === null) {
      return refused("unknown");
    }

    // b. The idempotency key.
    const key = databaseKey("add", input.idempotencyKey);
    if (key === null) {
      return refused("unknown");
    }

    // c. The amount.
    const amount = readAmount(input.amount);
    if (typeof amount !== "bigint") {
      return amount;
    }

    // d. The accounts, from the database. The caller names none: Add money
    //    always goes from the household's bank account to its wallet.
    const accounts = await loadAccounts(deps, household, "addMoney");
    if (accounts === null) {
      return refused("unknown");
    }

    // e. Exactly one bank account and exactly one wallet, both this
    //    household's own (they come from this household's list only).
    const banks = accounts.filter((account) => account.kind === "bank_source");
    const wallets = accounts.filter((account) => account.kind === "wallet");
    if (banks.length !== 1 || wallets.length !== 1) {
      deps.logError("addMoney failed: the household does not have exactly one bank account and one wallet.");
      return refused("unknown");
    }

    // f. The ceiling.
    if (!ceilingAllows(householdTotalKobo(accounts), amount)) {
      return refused("ceiling");
    }

    // The same household, and the person, go to post_transaction_by. This
    // check and the database's own refusal of entries on another
    // household's accounts are two separate layers: either one alone would
    // stop a mix-up. The database also refuses a person who is not a member
    // of the household (not_member), which becomes "unknown".
    return await post(deps, "addMoney", {
      householdId: household,
      createdBy: person,
      description: "Add money to the wallet",
      idempotencyKey: key,
      entries: buildEntries(banks[0].account_id, wallets[0].account_id, amount),
    });
  } catch (problem) {
    deps.logError(`addMoney failed unexpectedly: ${describeProblem(problem)}`);
    return refused("unknown");
  }
}

// ---------------------------------------------------------------------
// Move money: wallet to pot, or pot to wallet
// ---------------------------------------------------------------------

// householdId and createdBy are supplied by the caller: the signed-in
// person's own household and their own id, from their session on the
// server. Neither is ever read from the form: the input object has no
// household or person in it, and any extra field the form sends is ignored.
export async function runMoveMoney(householdId: unknown, createdBy: unknown, input: MoveMoneyInput, deps: MoveDeps): Promise<MoveResult> {
  try {
    // a. The kill switch, before anything else.
    if (!deps.writesEnabled()) {
      return refused("writes_off");
    }

    //    The household: a properly formed UUID, or nothing is done. A bad
    //    one is a mistake in the app, so it is "unknown", and the database
    //    is not asked anything.
    const household = normaliseAccountId(householdId);
    if (household === null) {
      return refused("unknown");
    }

    //    The person making it: a properly formed UUID too, or nothing is
    //    done and the database is not asked anything.
    const person = normaliseAccountId(createdBy);
    if (person === null) {
      return refused("unknown");
    }

    // b. The idempotency key.
    const key = databaseKey("move", input.idempotencyKey);
    if (key === null) {
      return refused("unknown");
    }

    // c. The amount.
    const amount = readAmount(input.amount);
    if (typeof amount !== "bigint") {
      return amount;
    }

    // d. The account ids: properly formed, and two different accounts.
    //    A badly formed id is "unknown"; the same account twice is
    //    "bad_accounts", a choice the visitor can correct.
    const fromId = normaliseAccountId(input.fromAccountId);
    const toId = normaliseAccountId(input.toAccountId);
    if (fromId === null || toId === null) {
      return refused("unknown");
    }
    if (fromId === toId) {
      return refused("bad_accounts");
    }

    //    Then their kinds and names, from the database, for this household
    //    only. An account of any other household is simply not in this
    //    list, so it is "unknown", the same as one that does not exist.
    const accounts = await loadAccounts(deps, household, "moveMoney");
    if (accounts === null) {
      return refused("unknown");
    }
    const from = accounts.find((account) => account.account_id === fromId);
    const to = accounts.find((account) => account.account_id === toId);
    if (from === undefined || to === undefined) {
      return refused("unknown");
    }

    // e. Wallet to pot, or pot to wallet. Never the bank, never pot to pot.
    //    An account not found in the household stays "unknown" above; a
    //    found pair that breaks this rule is "bad_accounts".
    if (!isAllowedMove(from.kind, to.kind)) {
      return refused("bad_accounts");
    }

    // The same household, and the person, go to post_transaction_by. This
    // check and the database's own refusal of entries on another
    // household's accounts are two separate layers: either one alone would
    // stop a mix-up. The database also refuses a person who is not a member
    // of the household (not_member), which becomes "unknown".
    return await post(deps, "moveMoney", {
      householdId: household,
      createdBy: person,
      description: `Move money from ${from.name} to ${to.name}`,
      idempotencyKey: key,
      entries: buildEntries(from.account_id, to.account_id, amount),
    });
  } catch (problem) {
    deps.logError(`moveMoney failed unexpectedly: ${describeProblem(problem)}`);
    return refused("unknown");
  }
}
