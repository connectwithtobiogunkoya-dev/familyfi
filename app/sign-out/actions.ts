"use server";

// The server action behind the "Sign out" button.
//
// It ends the session in the database, deletes the session cookie
// (always, even if the database could not be reached), and sends the
// browser to the start page. Next.js's own checks for server actions stay
// exactly as they are.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, deleteSessionCookieOptions } from "../../lib/session-cookie";
import { endCurrentSession } from "../../lib/sign-out";
import { runSignOutAction } from "../../lib/sign-out-action-core";

export async function signOutAction(): Promise<void> {
  const outcome = await runSignOutAction({ endCurrentSession });

  if (outcome.deleteCookie) {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, "", deleteSessionCookieOptions(process.env.NODE_ENV === "production"));
  }

  // Outside any try block: redirect works by stopping the action.
  redirect(outcome.redirectTo);
}
