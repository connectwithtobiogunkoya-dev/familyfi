// Signing up: the server-only front door. The rules are in
// lib/signup-core.ts; this file plugs in the real settings, secrets and
// database.
//
// The caller (a server action) puts the returned session token in the
// cookie and must never return the token to the browser itself.
import "server-only";

import { generateAccessCode } from "./access-code.ts";
import { createHousehold } from "./auth-db.ts";
import type { IdentityInput } from "./identity.ts";
import { getAccessCodeKeys, getVisitorKey } from "./secrets.ts";
import { generateSessionToken } from "./session-token.ts";
import { signupsEnabled } from "./settings.ts";
import { runSignUp, type SignUpContext, type SignUpResult } from "./signup-core.ts";

export async function signUp(rawForm: IdentityInput, context: SignUpContext): Promise<SignUpResult> {
  return runSignUp(rawForm, context, {
    signupsEnabled: () => signupsEnabled(),
    accessCodeKeys: getAccessCodeKeys,
    visitorKey: getVisitorKey,
    createHousehold,
    generateAccessCode: () => generateAccessCode(),
    generateSessionToken,
  });
}
