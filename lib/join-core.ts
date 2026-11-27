// Joining a household with an invite code: the rules, in a fixed order.
//
// The same order as signing up (lib/signup-core.ts), with no household
// name. Like sign-up, joining is gated by SIGNUPS_ENABLED only; the money
// switch, WRITES_ENABLED, has no effect on it.
//   a. Sign-up switched off (SIGNUPS_ENABLED, which also gates joining):
//      "paused".
//   b. A secret missing or bad: fail closed with the plain "unknown"
//      sentence. No crash, no detail.
//   c. The typed details are checked with the same rules and the same
//      fixed sentences as sign-up. Nothing is made and the database is not
//      asked.
//   d. A NIN or BVN ending in 99 (the simulated check): "not_verified".
//      The database is not asked.
//   e. Only now is anything made: the person's access code (with its
//      fingerprint and locked copy), a session token (with its
//      fingerprint), the visitor's fingerprint, and the typed invite code's
//      fingerprint. The invite code is always fingerprinted and sent, proper
//      code or not, so every wrong guess is counted.
//   f. join_household is called once.
//   g. On "joined", the result holds only "ok" and the session token, for
//      the caller to put in the cookie. Otherwise, one fixed sentence.
//
// The result never holds the invite code, any fingerprint, any id, the
// access code, the NIN, the BVN or the phone.
//
// The database is reached only through "deps", so tests can hand in
// stand-ins. lib/join.ts plugs in the real ones and is server-only.

import { accessCodeFingerprint } from "./access-code.ts";
import { encryptAccessCode } from "./access-code-crypto.ts";
import type { JoinHouseholdArgs, JoinHouseholdResult } from "./auth-db-core.ts";
import { AUTH_LIMITS, INVITE_LIMITS, maxSignUpsPerVisitor } from "./auth-limits.ts";
import { checkIdentity, type FieldError, type IdentityField } from "./identity.ts";
import { inviteCodeFingerprint } from "./invite-code.ts";
import { joinSentence, type JoinRefusalCode } from "./invite-rules.ts";
import { CURRENT_KEY_VERSION } from "./secrets-core.ts";
import { sessionTokenFingerprint } from "./session-token.ts";
import { SIGNUPS_PAUSED_SENTENCE } from "./signup-form-state.ts";
import { visitorFingerprint } from "./visitor.ts";

/** What the Join form sends, before any checking. No household name. */
export type JoinInput = {
  inviteCode: unknown;
  fullName: unknown;
  phone: unknown;
  dateOfBirth: unknown;
  role: unknown;
  nin: unknown;
  bvn: unknown;
  testTermsAccepted: unknown;
};

export type JoinContext = {
  // The visitor's address, from visitorAddress (or "unknown").
  address: string;
  // Whether the app is running on a developer's own computer.
  isDevelopment: boolean;
  // The moment of the join, for the age check.
  now: Date;
};

export type JoinDeps = {
  signupsEnabled: () => boolean;
  accessCodeKeys: () => ReadonlyMap<number, Buffer> | null;
  visitorKey: () => string | null;
  joinHousehold: (args: JoinHouseholdArgs) => Promise<JoinHouseholdResult>;
  generateAccessCode: () => string;
  generateSessionToken: () => string;
};

/** Why a join did not happen, as a code with one fixed sentence. */
export type JoinRefusal = "invite_not_valid" | "too_many_attempts" | JoinRefusalCode | "unknown";

export type JoinResult =
  | { status: "paused"; message: string }
  | { status: "field_errors"; fields: Partial<Record<IdentityField, FieldError>> }
  | { status: "not_verified"; message: string }
  | { status: "refused"; code: JoinRefusal; message: string }
  | { status: "ok"; sessionToken: string };

function refused(code: JoinRefusal): JoinResult {
  return { status: "refused", code, message: joinSentence(code) };
}

export async function runJoin(rawForm: JoinInput, context: JoinContext, deps: JoinDeps): Promise<JoinResult> {
  // a. The sign-up switch.
  if (!deps.signupsEnabled()) {
    return { status: "paused", message: SIGNUPS_PAUSED_SENTENCE };
  }

  // b. The secrets. Missing or bad: fail closed.
  const keys = deps.accessCodeKeys();
  const lockingKey = keys?.get(CURRENT_KEY_VERSION) ?? null;
  const visitorKey = deps.visitorKey();
  if (lockingKey === null || visitorKey === null) {
    return refused("unknown");
  }

  // c. and d. The typed details, then the simulated check. The household
  //    name is not asked for when joining, so it is checked as empty.
  const identity = checkIdentity(
    {
      fullName: rawForm.fullName,
      phone: rawForm.phone,
      dateOfBirth: rawForm.dateOfBirth,
      role: rawForm.role,
      nin: rawForm.nin,
      bvn: rawForm.bvn,
      householdName: "",
      testTermsAccepted: rawForm.testTermsAccepted,
    },
    context.now,
  );
  if (identity.outcome === "field_errors") {
    return { status: "field_errors", fields: identity.fields };
  }
  if (identity.outcome === "not_verified") {
    return { status: "not_verified", message: joinSentence("not_verified") };
  }
  const details = identity.details;

  try {
    // e. Only now: the access code, the session token, the fingerprints.
    const accessCode = deps.generateAccessCode();
    const sessionToken = deps.generateSessionToken();

    const args: JoinHouseholdArgs = {
      fullName: details.fullName,
      phone: details.phone,
      dateOfBirth: details.dateOfBirth,
      role: details.role,
      nin: details.nin,
      bvn: details.bvn,
      testTermsAccepted: true,
      inviteHash: inviteCodeFingerprint(rawForm.inviteCode),
      codeHash: accessCodeFingerprint(accessCode),
      codeEncrypted: encryptAccessCode(accessCode, lockingKey),
      keyVersion: CURRENT_KEY_VERSION,
      visitorHash: visitorFingerprint(context.address, visitorKey),
      maxSignUpsPerVisitor: maxSignUpsPerVisitor(context.address, context.isDevelopment),
      maxCustomersPerDay: AUTH_LIMITS.customersPerDay,
      maxCustomersTotal: AUTH_LIMITS.customersTotal,
      maxWrongInvitesPer15Minutes: INVITE_LIMITS.wrongInvitesPer15Minutes,
      maxWrongInvitesPer24Hours: INVITE_LIMITS.wrongInvitesPer24Hours,
      tokenHash: sessionTokenFingerprint(sessionToken),
      idleDays: AUTH_LIMITS.sessionIdleDays,
      absoluteDays: AUTH_LIMITS.sessionAbsoluteDays,
    };

    // f. One call. No retry: see joinHouseholdCall in lib/auth-db-core.ts.
    const result = await deps.joinHousehold(args);

    // g.
    switch (result.status) {
      case "joined":
        return { status: "ok", sessionToken };
      case "invite_not_valid":
      case "too_many_attempts":
        return refused(result.status);
      case "refused":
        return refused(result.code);
      default:
        return refused("unknown");
    }
  } catch {
    // Anything unexpected while making or sending: fail closed.
    return refused("unknown");
  }
}
