"use server";

// The server action behind the Join form.
//
// "use server" means this runs only on the server. Next.js's own checks
// for server actions (such as refusing a request from another site) stay
// exactly as they are.
//
// The rules are in lib/join-action-core.ts and lib/join-core.ts: only the
// eight named fields are read (no household and no person from the form),
// SIGNUPS_ENABLED gates it, the details are checked before the database is
// asked, and every refusal is one fixed sentence. The session token goes
// only into the cookie; what this returns to the browser is the small form
// state, which never holds the invite code, a fingerprint, an id or the
// token.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { join } from "../../lib/join";
import { runJoinAction } from "../../lib/join-action-core";
import type { JoinFormState } from "../../lib/join-form-state";
import { getRequestContext } from "../../lib/request-context";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../../lib/session-cookie";

export async function joinAction(_previous: JoinFormState, formData: FormData): Promise<JoinFormState> {
  const outcome = await runJoinAction(formData, {
    join,
    getContext: getRequestContext,
    setCookie: async (sessionToken) => {
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(process.env.NODE_ENV === "production"));
    },
    now: () => new Date(),
  });

  // runJoinAction never throws, so there is no try block here. redirect
  // works by stopping the action, which is why it must never sit in one.
  if ("redirectTo" in outcome) {
    redirect(outcome.redirectTo);
  }
  return outcome;
}
