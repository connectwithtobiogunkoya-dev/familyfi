// The household screen, /app/household: the choices it makes, kept apart
// from the page so they can be tested on their own.
//
//   householdView            which of the three views the person gets
//   showLoneOwnerBanner      whether /app shows the "only one here" banner
//   runCreateInviteAction    the create button's action: where to go next
//   pathAfterCreateInvite    the address to go to after creating
//   readHouseholdError       an error code from the address, from a fixed list
//   householdErrorSentence   that code's one fixed sentence
//
// Only fixed addresses come out of here. The invite code is never put in
// an address: after creating, the screen reads the code again and shows it
// inside a page built on the server for the owner.

import type { HouseholdMember } from "./auth-db-core.ts";
import { runCreateInvite, type CreateInviteDeps, type CreateInviteOutcome, type ReadMembersOutcome } from "./household-core.ts";
import { inviteRefusalSentence } from "./invite-rules.ts";
import { SIGNUPS_PAUSED_SENTENCE } from "./signup-form-state.ts";

/** What the screen shows under the members. */
export type HouseholdView = "owner_alone" | "owner_full" | "partner";

/**
 * Which view the signed-in person gets, from the members list:
 *   owner_alone  the owner, with no partner yet: the invite section
 *   owner_full   the owner, with a partner: "Your household is full."
 *   partner      the partner: "Only the person who created ..."
 * Null if the list does not make sense (no one marked as you).
 */
export function householdView(members: readonly HouseholdMember[]): HouseholdView | null {
  const me = members.filter((member) => member.isYou);
  if (me.length !== 1) {
    return null;
  }
  if (me[0].memberRole === "partner") {
    return "partner";
  }
  return members.some((member) => member.memberRole === "partner") ? "owner_full" : "owner_alone";
}

/**
 * Whether /app shows "You're the only one here yet. Invite your partner
 * from Household.": only for an owner who is the household's one member.
 * Not for a partner, not for an owner with a partner, and not when the
 * members could not be read.
 */
export function showLoneOwnerBanner(outcome: ReadMembersOutcome): boolean {
  if (outcome.status !== "members" || outcome.members.length !== 1) {
    return false;
  }
  const [only] = outcome.members;
  return only.isYou === true && only.memberRole === "owner";
}

/** The error codes the household screen accepts from its address. Nothing else is shown. */
export const HOUSEHOLD_ERROR_CODES = ["paused", "not_owner", "household_full", "limit_invites", "unknown"] as const;
export type HouseholdErrorCode = (typeof HOUSEHOLD_ERROR_CODES)[number];

/** An error code from the address, such as ?error=not_owner, or null. Only exact codes on the list count. */
export function readHouseholdError(value: unknown): HouseholdErrorCode | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const code of HOUSEHOLD_ERROR_CODES) {
    if (value === code) {
      return code;
    }
  }
  return null;
}

/** The one fixed sentence for each error code. */
export function householdErrorSentence(code: HouseholdErrorCode): string {
  return code === "paused" ? SIGNUPS_PAUSED_SENTENCE : inviteRefusalSentence(code);
}

/**
 * The address to go to once creating has answered:
 *   created     -> /app/household (the new code is read and shown there)
 *   signed_out  -> /sign-in
 *   paused      -> /app/household?error=paused
 *   refused     -> /app/household?error=<code from the fixed list>
 */
export function pathAfterCreateInvite(outcome: CreateInviteOutcome): string {
  switch (outcome.status) {
    case "created":
      return "/app/household";
    case "signed_out":
      return "/sign-in";
    case "paused":
      return "/app/household?error=paused";
    case "refused": {
      const code: HouseholdErrorCode =
        outcome.code === "not_owner" || outcome.code === "household_full" || outcome.code === "limit_invites" ? outcome.code : "unknown";
      return `/app/household?error=${code}`;
    }
  }
}

/** The create button's action: the create rules, then where to go next. */
export async function runCreateInviteAction(deps: CreateInviteDeps): Promise<string> {
  return pathAfterCreateInvite(await runCreateInvite(deps));
}
