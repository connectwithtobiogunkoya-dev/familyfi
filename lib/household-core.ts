// The household screen's logic, for the owner and the partner: the rules,
// in a file tests can load. lib/household.ts plugs in the real session,
// switch, secrets and database, and is server-only.
//
//   runCreateInvite   the owner creates an invite code
//   runReadInvite     the owner sees the unused invite code again
//   runReadMembers    anyone in the household sees who is in it
//
// The person always comes from the session, and the household from the
// database's own lookup of that person. Nothing here takes a household id,
// and nothing reads one from a form or an address.
//
// What may come back to the screen: a status, one fixed sentence, the
// invite code formatted in four groups with its "Stops working" line, and
// the members' names and roles. Never a fingerprint, the locked copy, a
// key or any id. Nothing is logged.

import type { ActiveInviteResult, CreateInviteArgs, CreateInviteResult, HouseholdMember } from "./auth-db-core.ts";
import { INVITE_LIMITS } from "./auth-limits.ts";
import { formatInviteCode, inviteCodeFingerprint, lockInviteCode, unlockInviteCode } from "./invite-code.ts";
import { inviteRefusalSentence, type InviteRefusalCode } from "./invite-rules.ts";
import { stopsWorkingLine } from "./lagos-time.ts";
import { CURRENT_KEY_VERSION } from "./secrets-core.ts";
import type { SessionPerson } from "./session-core.ts";
import { SIGNUPS_PAUSED_SENTENCE } from "./signup-form-state.ts";

// ---------------------------------------------------------------------
// Creating an invite
// ---------------------------------------------------------------------

export type CreateInviteDeps = {
  writesEnabled: () => boolean;
  getSession: () => Promise<SessionPerson | null>;
  accessCodeKeys: () => ReadonlyMap<number, Buffer> | null;
  createInvite: (args: CreateInviteArgs) => Promise<CreateInviteResult>;
  generateInviteCode: () => string;
};

export type CreateInviteOutcome =
  | { status: "paused"; message: string }
  | { status: "signed_out" }
  | { status: "created" }
  | { status: "refused"; code: InviteRefusalCode | "unknown"; message: string };

async function sessionOrNull(getSession: () => Promise<SessionPerson | null>): Promise<SessionPerson | null> {
  try {
    return await getSession();
  } catch {
    return null;
  }
}

function inviteRefused(code: InviteRefusalCode | "unknown"): CreateInviteOutcome {
  return { status: "refused", code, message: inviteRefusalSentence(code) };
}

/**
 * Create an invite code for the signed-in owner. In this order: the write
 * switch, then the session, then the secrets, then the database call. The
 * database alone decides who is the owner: a partner's session is refused
 * there with "not_owner", whatever the screen shows.
 *
 * The new code is not given back: the screen reads it again with
 * runReadInvite, so the code travels only inside a page built on the
 * server for the owner.
 */
export async function runCreateInvite(deps: CreateInviteDeps): Promise<CreateInviteOutcome> {
  // 1. The write switch.
  if (!deps.writesEnabled()) {
    return { status: "paused", message: SIGNUPS_PAUSED_SENTENCE };
  }

  // 2. The session. With none, nothing else happens.
  const person = await sessionOrNull(deps.getSession);
  if (person === null) {
    return { status: "signed_out" };
  }

  // 3. The locking key. Missing: fail closed.
  const lockingKey = deps.accessCodeKeys()?.get(CURRENT_KEY_VERSION) ?? null;
  if (lockingKey === null) {
    return inviteRefused("unknown");
  }

  // 4. The call. A new code's fingerprint already in use is practically
  //    impossible; if it happens, one fresh code is tried once more.
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const code = deps.generateInviteCode();
      const result = await deps.createInvite({
        customerId: person.customerId,
        codeHash: inviteCodeFingerprint(code),
        codeEncrypted: lockInviteCode(code, lockingKey),
        keyVersion: CURRENT_KEY_VERSION,
        maxPerDay: INVITE_LIMITS.invitesPerHouseholdPer24Hours,
      });
      if (result.ok) {
        return { status: "created" };
      }
      if (result.code !== "code_taken") {
        return inviteRefused(result.code);
      }
    }
    return inviteRefused("code_taken");
  } catch {
    return inviteRefused("unknown");
  }
}

// ---------------------------------------------------------------------
// Seeing the unused invite again
// ---------------------------------------------------------------------

export type ReadInviteDeps = {
  getSession: () => Promise<SessionPerson | null>;
  accessCodeKeys: () => ReadonlyMap<number, Buffer> | null;
  getActiveInvite: (customerId: string) => Promise<ActiveInviteResult>;
};

export type ReadInviteOutcome =
  | { status: "signed_out" }
  | { status: "none" }
  | { status: "active"; code: string; stopsWorking: string }
  | { status: "failed"; message: string };

/**
 * The signed-in owner's unused invite code, unlocked here on the server
 * and formatted, with its "Stops working" line in Lagos time. A partner,
 * or an owner with no unused code, gets "none" (the database decides).
 */
export async function runReadInvite(deps: ReadInviteDeps): Promise<ReadInviteOutcome> {
  const person = await sessionOrNull(deps.getSession);
  if (person === null) {
    return { status: "signed_out" };
  }

  const failed: ReadInviteOutcome = { status: "failed", message: inviteRefusalSentence("unknown") };
  try {
    const invite = await deps.getActiveInvite(person.customerId);
    if (invite.kind === "none") {
      return { status: "none" };
    }
    if (invite.kind !== "active") {
      return failed;
    }
    const key = deps.accessCodeKeys()?.get(invite.keyVersion) ?? null;
    if (key === null) {
      return failed;
    }
    const stopsWorking = stopsWorkingLine(invite.expiresAt);
    if (stopsWorking === null) {
      return failed;
    }
    return { status: "active", code: formatInviteCode(unlockInviteCode(invite.codeEncrypted, key)), stopsWorking };
  } catch {
    // A copy that will not unlock, or anything else: the plain sentence,
    // with no detail.
    return failed;
  }
}

// ---------------------------------------------------------------------
// Who is in the household
// ---------------------------------------------------------------------

export type ReadMembersDeps = {
  getSession: () => Promise<SessionPerson | null>;
  getHouseholdMembers: (customerId: string) => Promise<HouseholdMember[] | null>;
};

export type ReadMembersOutcome =
  | { status: "signed_out" }
  | { status: "members"; members: HouseholdMember[] }
  | { status: "failed"; message: string };

/** The members of the signed-in person's household: names, roles and which one is you. */
export async function runReadMembers(deps: ReadMembersDeps): Promise<ReadMembersOutcome> {
  const person = await sessionOrNull(deps.getSession);
  if (person === null) {
    return { status: "signed_out" };
  }
  try {
    const members = await deps.getHouseholdMembers(person.customerId);
    if (members === null) {
      return { status: "failed", message: inviteRefusalSentence("unknown") };
    }
    // Copied field by field, so nothing else can ride along.
    return {
      status: "members",
      members: members.map((m) => ({ fullName: m.fullName, memberRole: m.memberRole, isYou: m.isYou })),
    };
  } catch {
    return { status: "failed", message: inviteRefusalSentence("unknown") };
  }
}
