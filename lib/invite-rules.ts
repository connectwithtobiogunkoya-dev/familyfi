// The refusal codes and statuses of the Slice 6 invite functions, and the
// sentence a visitor sees for each.
//
// Only the code at the start of a database message is ever read; the rest
// of the message is never passed on. Every sentence here was approved in
// docs/slice-6-plan.md (section J), or is an existing sentence from
// lib/auth-limits.ts or lib/signup-form-state.ts.

import { signInSentence, signUpRefusalSentence } from "./auth-limits.ts";

/** Every refusal code create_invite can raise. Nothing else is accepted. */
export const INVITE_REFUSAL_CODES = ["bad_request", "not_owner", "household_full", "limit_invites", "code_taken"] as const;
export type InviteRefusalCode = (typeof INVITE_REFUSAL_CODES)[number];

/** Every refusal code join_household can raise. Nothing else is accepted. */
export const JOIN_REFUSAL_CODES = [
  "bad_request",
  "limit_visitor",
  "limit_daily",
  "limit_total",
  "bad_details",
  "not_verified",
  "under_18",
  "code_taken",
] as const;
export type JoinRefusalCode = (typeof JOIN_REFUSAL_CODES)[number];

/** Every status join_household gives back as a normal result. */
export const JOIN_STATUSES = ["joined", "invite_not_valid", "too_many_attempts"] as const;
export type JoinStatus = (typeof JOIN_STATUSES)[number];

// Database messages are short. Anything longer is not one of ours.
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
 * Read the refusal code at the start of a database message ("not_owner:
 * Only the ..." gives "not_owner"). Only a code on the given list, followed
 * directly by a colon, is accepted; anything else gives "unknown". It never
 * gives back any other part of the message.
 */
export function readRefusalCode<Code extends string>(error: unknown, codes: readonly Code[]): Code | "unknown" {
  const message = messageOf(error);
  if (message === null || message.length > MAX_MESSAGE_LENGTH) {
    return "unknown";
  }
  const colonAt = message.indexOf(":");
  if (colonAt === -1) {
    return "unknown";
  }
  const code = message.slice(0, colonAt);
  for (const known of codes) {
    if (code === known) {
      return known;
    }
  }
  return "unknown";
}

/** The household screen's sentence when an invite cannot be made or shown. */
export const INVITE_TRY_AGAIN_SENTENCE = "We could not create an invite code right now. Please try again.";

/** The sentence when a join fails for a reason that is not the visitor's. */
export const JOIN_TRY_AGAIN_SENTENCE = "We could not join you to the household right now. Please try again.";

/** The sentence for a wrong, used, voided or expired invite code, and for a full household. */
export const INVITE_NOT_VALID_SENTENCE = "That invite code did not work. Check it with your partner and try again.";

/** The one sentence the owner sees for each create_invite refusal. */
export function inviteRefusalSentence(code: InviteRefusalCode | "unknown"): string {
  switch (code) {
    case "not_owner":
      return "Only the person who created the household can invite a partner.";
    case "household_full":
      return "Your partner has joined. Your household is full.";
    case "limit_invites":
      return "You have made too many invite codes today. Please try again tomorrow.";
    case "bad_request":
    case "code_taken":
    default:
      return INVITE_TRY_AGAIN_SENTENCE;
  }
}

/** The one sentence a person joining sees for each status or refusal that is not a success. */
export function joinSentence(code: Exclude<JoinStatus, "joined"> | JoinRefusalCode | "unknown"): string {
  switch (code) {
    case "invite_not_valid":
      return INVITE_NOT_VALID_SENTENCE;
    case "too_many_attempts":
      return signInSentence("too_many_attempts");
    case "bad_details":
    case "not_verified":
    case "under_18":
    case "limit_visitor":
    case "limit_daily":
    case "limit_total":
      return signUpRefusalSentence(code);
    case "bad_request":
    case "code_taken":
    default:
      return JOIN_TRY_AGAIN_SENTENCE;
  }
}
