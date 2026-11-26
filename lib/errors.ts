// Turning problems into calm sentences.
//
// When something goes wrong while moving money, the visitor must never
// see the real error: it can mention database details, account ids or
// other things that do not belong on a screen. This file is the filter
// between "what went wrong" and "what the visitor reads".
//
// It works in three stages:
//   1. toErrorCode    : whatever went wrong  ->  one short code
//   2. readErrorCode  : a code from the address bar  ->  the same code,
//                       but only if it is on the fixed list
//   3. errorSentence  : a code  ->  one fixed sentence
//
// The only words a visitor can ever be shown are the fixed sentences at
// the bottom of this file. Text from an error or from the address bar is
// never passed through.

import { AmountError } from "./amount.ts";

/** Every code there is. Nothing outside this list is ever used. */
export const ERROR_CODES = [
  "not_enough", // the wallet or pot does not hold that much
  "bad_amount", // the typed amount is not written like an amount
  "too_large", // the typed amount is over the per-move maximum
  "replayed", // this exact request was already done
  "writes_off", // the kill switch is off: money movement is paused
  "ceiling", // the household already holds the most it is allowed to
  "bad_accounts", // the same account twice, or a pair that is not wallet and pot
  "unknown", // anything else
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// The opening words of the overdraft error raised by the ledger rules in
// supabase/migrations/20261112120000_ledger_tables.sql. The mapping below
// recognises that error by these words, so a test checks that the
// migration still contains them.
export const NOT_ENOUGH_MONEY_PHRASE = "Not enough money";

/**
 * Stage 1. Turn whatever went wrong into one code from the fixed list.
 *
 * It accepts anything: a database error (an object with a message), an
 * AmountError from the amount parser, or something unexpected. The
 * original message is only ever looked at, never returned.
 */
export function toErrorCode(problem: unknown): ErrorCode {
  // A typed amount that the parser refused.
  if (problem instanceof AmountError) {
    return problem.problem === "too_large" ? "too_large" : "bad_amount";
  }

  // A database error: an object carrying a message. The only one given
  // its own code is the overdraft rule. Every other database error,
  // including "idempotency key already used for a different transaction"
  // (a mistake by the calling code, not by the visitor), is "unknown".
  if (typeof problem === "object" && problem !== null && "message" in problem) {
    const message = (problem as { message: unknown }).message;
    if (typeof message === "string" && message.startsWith(NOT_ENOUGH_MONEY_PHRASE)) {
      return "not_enough";
    }
  }

  return "unknown";
}

/**
 * Stage 2. Check a code taken from the address bar, such as the
 * "not_enough" in /app/move?error=not_enough.
 *
 * Anyone can type anything into an address, so the value is only accepted
 * if it is exactly one of the codes on the fixed list. Everything else,
 * including a list of values, gives null, which means "no error to show".
 */
export function readErrorCode(value: unknown): ErrorCode | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const code of ERROR_CODES) {
    if (value === code) {
      return code;
    }
  }
  return null;
}

/**
 * Stage 3. The one sentence a visitor is shown for each code.
 * These sentences are fixed. Nothing is ever added to them.
 */
export function errorSentence(code: ErrorCode): string {
  switch (code) {
    case "not_enough":
      return "There isn't enough money there to move that amount.";
    case "bad_amount":
      return "Please enter an amount like 1,000 or 1,000.50.";
    case "too_large":
      return "The most you can move at once is ₦1,000,000.";
    case "replayed":
      return "That was already done. Nothing moved a second time.";
    case "writes_off":
      return "Money movement is paused right now. Please try again later.";
    case "ceiling":
      return "This wallet has reached its limit, so no more money can be added.";
    case "bad_accounts":
      return "Choose two different accounts, and one of them must be the wallet.";
    default:
      // "unknown", and also any value that somehow is not on the list.
      return "We could not move the money right now. Please check the statement before trying again.";
  }
}
