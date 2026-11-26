// Signing up: the rules, in a fixed order.
//
//   a. Sign-up switched off: "paused", and nothing else happens.
//   b. A secret missing or bad: fail closed with the plain "unknown"
//      sentence. No crash, no detail.
//   c. The typed details are checked. Field problems come back with their
//      fixed sentences. Nothing is made and the database is not asked.
//   d. A NIN or BVN ending in 99 (the simulated check): "not_verified".
//      The database is not asked.
//   e. Only now is anything made: an access code (with its fingerprint
//      and locked copy), a session token (with its fingerprint), and the
//      visitor's fingerprint.
//   f. create_household is called once.
//   g. On success, the result holds only "ok" and the session token, for
//      the caller to put in the cookie. Never the access code, the NIN,
//      the BVN or the phone: the code is shown later by reading it back
//      from the database for the signed-in person.
//   h. On a refusal, the result holds the refusal's fixed sentence.
//
// The database is reached only through "deps", so tests can hand in
// stand-ins. lib/signup.ts plugs in the real ones and is server-only.
//
// The session token is returned to the server code that called this, to
// be put in the cookie there. That caller must never pass it on to the
// browser in a returned value: only the cookie carries it.

import { accessCodeFingerprint } from "./access-code.ts";
import { encryptAccessCode } from "./access-code-crypto.ts";
import type { CreateHouseholdArgs, CreateHouseholdResult } from "./auth-db-core.ts";
import { AUTH_LIMITS, maxSignUpsPerVisitor, signUpRefusalSentence, type SignUpRefusalCode } from "./auth-limits.ts";
import { checkIdentity, type FieldError, type IdentityField, type IdentityInput } from "./identity.ts";
import { CURRENT_KEY_VERSION } from "./secrets-core.ts";
import { sessionTokenFingerprint } from "./session-token.ts";
import { visitorFingerprint } from "./visitor.ts";

export type SignUpContext = {
  // The visitor's address, from visitorAddress (or "unknown").
  address: string;
  // Whether the app is running on a developer's own computer.
  isDevelopment: boolean;
  // The moment of the sign-up, for the age check.
  now: Date;
};

export type SignUpDeps = {
  signupsEnabled: () => boolean;
  accessCodeKeys: () => ReadonlyMap<number, Buffer> | null;
  visitorKey: () => string | null;
  createHousehold: (args: CreateHouseholdArgs) => Promise<CreateHouseholdResult>;
  generateAccessCode: () => string;
  generateSessionToken: () => string;
};

export type SignUpResult =
  | { status: "paused" }
  | { status: "field_errors"; fields: Partial<Record<IdentityField, FieldError>> }
  | { status: "not_verified"; message: string }
  | { status: "refused"; code: SignUpRefusalCode | "unknown"; message: string }
  | { status: "ok"; sessionToken: string };

function refused(code: SignUpRefusalCode | "unknown"): SignUpResult {
  return { status: "refused", code, message: signUpRefusalSentence(code) };
}

export async function runSignUp(rawForm: IdentityInput, context: SignUpContext, deps: SignUpDeps): Promise<SignUpResult> {
  // a. The sign-up switch.
  if (!deps.signupsEnabled()) {
    return { status: "paused" };
  }

  // b. The secrets. Missing or bad: fail closed.
  const keys = deps.accessCodeKeys();
  const lockingKey = keys?.get(CURRENT_KEY_VERSION) ?? null;
  const visitorKey = deps.visitorKey();
  if (lockingKey === null || visitorKey === null) {
    return refused("unknown");
  }

  // c. and d. The typed details, then the simulated check.
  const identity = checkIdentity(rawForm, context.now);
  if (identity.outcome === "field_errors") {
    return { status: "field_errors", fields: identity.fields };
  }
  if (identity.outcome === "not_verified") {
    return { status: "not_verified", message: signUpRefusalSentence("not_verified") };
  }
  const details = identity.details;

  try {
    // e. Only now: the access code, the session token and the visitor's
    //    fingerprint. Only fingerprints and the locked copy leave here.
    const accessCode = deps.generateAccessCode();
    const sessionToken = deps.generateSessionToken();

    const args: CreateHouseholdArgs = {
      fullName: details.fullName,
      phone: details.phone,
      dateOfBirth: details.dateOfBirth,
      role: details.role,
      nin: details.nin,
      bvn: details.bvn,
      householdName: details.householdName,
      testTermsAccepted: true,
      codeHash: accessCodeFingerprint(accessCode),
      codeEncrypted: encryptAccessCode(accessCode, lockingKey),
      keyVersion: CURRENT_KEY_VERSION,
      visitorHash: visitorFingerprint(context.address, visitorKey),
      maxSignUpsPerVisitor: maxSignUpsPerVisitor(context.address, context.isDevelopment),
      maxCustomersPerDay: AUTH_LIMITS.customersPerDay,
      maxCustomersTotal: AUTH_LIMITS.customersTotal,
      tokenHash: sessionTokenFingerprint(sessionToken),
      idleDays: AUTH_LIMITS.sessionIdleDays,
      absoluteDays: AUTH_LIMITS.sessionAbsoluteDays,
    };

    // f. One call. No retry: see createHouseholdCall in lib/auth-db-core.ts.
    const result = await deps.createHousehold(args);

    // g. and h.
    if (!result.ok) {
      return refused(result.code);
    }
    return { status: "ok", sessionToken };
  } catch {
    // Anything unexpected while making or sending: fail closed.
    return refused("unknown");
  }
}
