// Signing in: the server-only front door. The rules are in
// lib/signin-core.ts; this file plugs in the real secret and database.
//
// The caller (a server action) puts the returned session token in the
// cookie and must never return the token to the browser itself.
import "server-only";

import { signInWithCode } from "./auth-db.ts";
import { getVisitorKey } from "./secrets.ts";
import { generateSessionToken } from "./session-token.ts";
import { runSignIn, type SignInContext, type SignInResult } from "./signin-core.ts";

export async function signIn(typedCode: unknown, context: SignInContext): Promise<SignInResult> {
  return runSignIn(typedCode, context, {
    visitorKey: getVisitorKey,
    signInWithCode,
    generateSessionToken,
  });
}
