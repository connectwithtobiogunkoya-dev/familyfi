// Signing in with an access code: the rules.
//
//   * The visitor key missing or bad: fail closed with the plain
//     "unknown" sentence, and the database is not asked.
//   * Whatever was typed is tidied and fingerprinted, even if it is not a
//     proper code, and always sent to the database, so a wrong guess is
//     always counted against the limits.
//   * The plain code never leaves this function: only its fingerprint.
//   * The limits and session lengths come from AUTH_LIMITS.
//   * On success, the result holds only "ok" and the new session token,
//     for the caller to put in the cookie. Otherwise, a fixed sentence.
//
// The database is reached only through "deps", so tests can hand in
// stand-ins. lib/signin.ts plugs in the real ones and is server-only.

import { accessCodeFingerprint } from "./access-code.ts";
import type { SignInArgs, SignInCallResult } from "./auth-db-core.ts";
import { AUTH_LIMITS, signInSentence, type SignInStatus } from "./auth-limits.ts";
import { sessionTokenFingerprint } from "./session-token.ts";
import { visitorFingerprint } from "./visitor.ts";

export type SignInContext = {
  // The visitor's address, from visitorAddress (or "unknown").
  address: string;
};

export type SignInDeps = {
  visitorKey: () => string | null;
  signInWithCode: (args: SignInArgs) => Promise<SignInCallResult>;
  generateSessionToken: () => string;
};

export type SignInResult =
  | { status: "ok"; sessionToken: string }
  | { status: "refused"; reason: Exclude<SignInStatus, "signed_in"> | "unknown"; message: string };

function refused(reason: Exclude<SignInStatus, "signed_in"> | "unknown"): SignInResult {
  return { status: "refused", reason, message: signInSentence(reason) };
}

export async function runSignIn(typedCode: unknown, context: SignInContext, deps: SignInDeps): Promise<SignInResult> {
  const visitorKey = deps.visitorKey();
  if (visitorKey === null) {
    return refused("unknown");
  }

  try {
    const sessionToken = deps.generateSessionToken();
    const result = await deps.signInWithCode({
      // Always sent, proper code or not, so every guess is counted.
      codeHash: accessCodeFingerprint(typedCode),
      tokenHash: sessionTokenFingerprint(sessionToken),
      visitorHash: visitorFingerprint(context.address, visitorKey),
      maxWrongPer15Minutes: AUTH_LIMITS.wrongCodesPer15Minutes,
      maxWrongPer24Hours: AUTH_LIMITS.wrongCodesPer24Hours,
      idleDays: AUTH_LIMITS.sessionIdleDays,
      absoluteDays: AUTH_LIMITS.sessionAbsoluteDays,
    });

    if (result.status === "signed_in") {
      return { status: "ok", sessionToken };
    }
    return refused(result.status);
  } catch {
    return refused("unknown");
  }
}
