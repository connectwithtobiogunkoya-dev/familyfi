// Signing out: the server-only front door. The rules are in
// lib/sign-out-core.ts. This reads the real cookie and ends the session in
// the real database. Deleting the cookie is left to the caller (a server
// action), because a cookie can only be changed there.
import "server-only";

import { cookies } from "next/headers";

import { endSessionRow } from "./auth-db.ts";
import { SESSION_COOKIE_NAME } from "./session-cookie.ts";
import { runSignOut, type SignOutResult } from "./sign-out-core.ts";

export async function endCurrentSession(): Promise<SignOutResult> {
  const cookieStore = await cookies();
  return runSignOut(cookieStore.get(SESSION_COOKIE_NAME)?.value, endSessionRow);
}
