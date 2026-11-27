// The household screen's logic: the server-only front door. The rules are
// in lib/household-core.ts; this file plugs in the real session, switch,
// secrets and database. The screen and its action come in a later step.
import "server-only";

import { createInvite, getActiveInvite, getHouseholdMembers } from "./auth-db.ts";
import {
  runCreateInvite,
  runReadInvite,
  runReadMembers,
  type CreateInviteOutcome,
  type ReadInviteOutcome,
  type ReadMembersOutcome,
} from "./household-core.ts";
import { generateInviteCode } from "./invite-code.ts";
import { getAccessCodeKeys } from "./secrets.ts";
import { getSession } from "./session.ts";
import { signupsEnabled } from "./settings.ts";

/** Create an invite code for the signed-in owner. */
export async function createMyInvite(): Promise<CreateInviteOutcome> {
  return runCreateInvite({
    getSession,
    signupsEnabled: () => signupsEnabled(),
    accessCodeKeys: getAccessCodeKeys,
    createInvite,
    generateInviteCode: () => generateInviteCode(),
  });
}

/** The signed-in owner's unused invite code, ready to show. */
export async function readMyInvite(): Promise<ReadInviteOutcome> {
  return runReadInvite({ getSession, accessCodeKeys: getAccessCodeKeys, getActiveInvite });
}

/** The members of the signed-in person's household. */
export async function readMyHouseholdMembers(): Promise<ReadMembersOutcome> {
  return runReadMembers({ getSession, getHouseholdMembers });
}
