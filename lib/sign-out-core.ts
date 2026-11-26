// Signing out: the rules.
//
// The session is ended in the database (by its token's fingerprint), and
// the caller is always told to delete the cookie, even if the database
// call failed or there was no proper cookie. The cookie must go
// regardless: a browser that asked to sign out is never left signed in.

import { looksLikeSessionToken, sessionTokenFingerprint } from "./session-token.ts";

export type SignOutResult = {
  // Always true.
  deleteCookie: true;
  // Whether the database confirmed it ended a session just now.
  sessionEnded: boolean;
};

export async function runSignOut(
  cookieValue: unknown,
  endSessionRow: (tokenHash: string) => Promise<boolean>,
): Promise<SignOutResult> {
  let sessionEnded = false;
  if (looksLikeSessionToken(cookieValue)) {
    try {
      sessionEnded = (await endSessionRow(sessionTokenFingerprint(cookieValue))) === true;
    } catch {
      sessionEnded = false;
    }
  }
  return { deleteCookie: true, sessionEnded };
}
