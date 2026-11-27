// Joining a household: the server-only front door. The rules are in
// lib/join-core.ts; this file plugs in the real switches, secrets and
// database.
//
// The caller (a server action, in a later step) puts the returned session
// token in the cookie and must never return the token to the browser.
import "server-only";

import { generateAccessCode } from "./access-code.ts";
import { joinHousehold } from "./auth-db.ts";
import { runJoin, type JoinContext, type JoinInput, type JoinResult } from "./join-core.ts";
import { getAccessCodeKeys, getVisitorKey } from "./secrets.ts";
import { generateSessionToken } from "./session-token.ts";
import { signupsEnabled, writesEnabled } from "./settings.ts";

export async function join(rawForm: JoinInput, context: JoinContext): Promise<JoinResult> {
  return runJoin(rawForm, context, {
    writesEnabled: () => writesEnabled(),
    signupsEnabled: () => signupsEnabled(),
    accessCodeKeys: getAccessCodeKeys,
    visitorKey: getVisitorKey,
    joinHousehold,
    generateAccessCode: () => generateAccessCode(),
    generateSessionToken,
  });
}
