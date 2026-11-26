// Limits on signing up and signing in, and the sentences visitors see.
//
// One place for the numbers approved in docs/slice-5-plan.md (sections D
// and F). They are sent to the database functions as plain numbers, so
// changing one here changes it everywhere, without a new migration.
//
// It also reads the refusal codes the database sends back, and turns each
// into one fixed sentence. Only the code is ever read; the rest of the
// database's message is never passed on to a visitor.

import { UNKNOWN_VISITOR } from "./visitor.ts";

export const AUTH_LIMITS = {
  /** Sign-ups from one visitor in 24 hours. */
  signUpsPerVisitorPer24Hours: 3,
  /** New customers per day (Lagos calendar day), everyone together. */
  customersPerDay: 50,
  /** Customers in total. */
  customersTotal: 300,
  /** Wrong access codes from one visitor in 15 minutes. */
  wrongCodesPer15Minutes: 5,
  /** Wrong access codes from one visitor in 24 hours. */
  wrongCodesPer24Hours: 20,
  /** A session ends after this many days without use. */
  sessionIdleDays: 30,
  /** A session ends after this many days whatever. */
  sessionAbsoluteDays: 180,
} as const;

// How often a session's last use is moved forward (at most once an hour)
// is decided by the database function get_session alone, so it is not
// repeated here.

// On a developer's own computer every request has no visitor address, so
// they all share the "unknown" bucket and the normal limit would be used
// up after a few test sign-ups. This higher limit applies only there.
const DEVELOPMENT_UNKNOWN_VISITOR_SIGN_UPS = 1000;

/**
 * How many sign-ups one visitor may make in 24 hours.
 *
 * The normal limit, except when the app is running in development and the
 * visitor has no address (the "unknown" bucket): then 1000, so local
 * testing is not blocked. On the live site, or for any real address, it
 * is always the normal limit.
 */
export function maxSignUpsPerVisitor(address: string, isDevelopment: boolean): number {
  if (isDevelopment === true && address === UNKNOWN_VISITOR) {
    return DEVELOPMENT_UNKNOWN_VISITOR_SIGN_UPS;
  }
  return AUTH_LIMITS.signUpsPerVisitorPer24Hours;
}

// ---------------------------------------------------------------------
// Sign-up refusals (raised by create_household)
// ---------------------------------------------------------------------

/** Every refusal code create_household can send. Nothing else is accepted. */
export const SIGN_UP_REFUSAL_CODES = [
  "bad_details",
  "not_verified",
  "under_18",
  "bad_request",
  "limit_visitor",
  "limit_daily",
  "limit_total",
  "code_taken",
  "numbers_exhausted",
] as const;

export type SignUpRefusalCode = (typeof SIGN_UP_REFUSAL_CODES)[number];

// Database messages are short. Anything longer than this is not one of
// ours, and is not looked at.
const MAX_MESSAGE_LENGTH = 1000;

function messageOf(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

/**
 * Read the refusal code at the start of a database error message, such as
 * "under_18: The person must be 18 or over." gives "under_18".
 *
 * It accepts the message itself or an error object carrying it. Only a
 * code on the list above, followed directly by a colon, is accepted.
 * Anything else gives "unknown": no colon, a code not on the list, a code
 * in different capitals or with spaces, or something that is not text.
 * It never gives back any part of the message other than the code.
 */
export function readSignUpRefusal(error: unknown): SignUpRefusalCode | "unknown" {
  const message = messageOf(error);
  if (message === null || message.length > MAX_MESSAGE_LENGTH) {
    return "unknown";
  }
  const colonAt = message.indexOf(":");
  if (colonAt === -1) {
    return "unknown";
  }
  const code = message.slice(0, colonAt);
  for (const known of SIGN_UP_REFUSAL_CODES) {
    if (code === known) {
      return known;
    }
  }
  return "unknown";
}

// The three limits share one sentence, so a visitor cannot tell which
// limit was reached.
const LIMIT_SENTENCE = "Sign-up is not available right now. Please try again later.";
const TRY_AGAIN_SENTENCE = "We could not create your household right now. Please try again.";

/** The one sentence a visitor sees for each sign-up refusal. */
export function signUpRefusalSentence(code: SignUpRefusalCode | "unknown"): string {
  switch (code) {
    case "bad_details":
      return "Some details are not in the right form. Please check them and try again.";
    case "not_verified":
      return "We could not verify these details. This is a simulated check.";
    case "under_18":
      return "You must be 18 or over to sign up.";
    case "limit_visitor":
    case "limit_daily":
    case "limit_total":
      return LIMIT_SENTENCE;
    case "bad_request":
    case "code_taken":
    case "numbers_exhausted":
      return TRY_AGAIN_SENTENCE;
    default:
      return "We could not create your household right now. Please try again later.";
  }
}

// ---------------------------------------------------------------------
// Sign-in results (returned by sign_in_with_code)
// ---------------------------------------------------------------------

/** Every status sign_in_with_code can return. */
export const SIGN_IN_STATUSES = ["signed_in", "wrong_code", "too_many_attempts", "no_household"] as const;

export type SignInStatus = (typeof SIGN_IN_STATUSES)[number];

/**
 * Read the status from what sign_in_with_code returned: either the result
 * object ({"status": "wrong_code"}) or the status text itself. Anything
 * that is not exactly one of the statuses above gives "unknown".
 */
export function readSignInStatus(result: unknown): SignInStatus | "unknown" {
  let status: unknown = result;
  if (typeof result === "object" && result !== null && !Array.isArray(result) && "status" in result) {
    status = (result as { status: unknown }).status;
  }
  if (typeof status !== "string") {
    return "unknown";
  }
  for (const known of SIGN_IN_STATUSES) {
    if (status === known) {
      return known;
    }
  }
  return "unknown";
}

/** The one sentence a visitor sees for each sign-in result. */
export function signInSentence(status: SignInStatus | "unknown"): string {
  switch (status) {
    case "signed_in":
      return "You are signed in.";
    case "wrong_code":
      return "That access code did not work. Check it and try again.";
    case "too_many_attempts":
      return "Too many attempts. Please wait 15 minutes and try again.";
    case "no_household":
    default:
      return "We could not sign you in right now. Please try again later.";
  }
}
