"use server";

// The server action behind the sign-up form.
//
// "use server" means this runs only on the server. The browser can ask
// for it to run by sending the form, but never sees or runs the code.
// Next.js's own checks for server actions (such as refusing a request
// from another site) stay exactly as they are.
//
// The rules are in lib/signup-action-core.ts. This file plugs in the real
// sign-up, the real request details and the real cookie. The session
// token goes only into the cookie: what this returns to the browser is
// the small form state, which never holds it.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getRequestContext } from "../../lib/request-context";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../../lib/session-cookie";
import { signUp } from "../../lib/signup";
import { runSignUpAction } from "../../lib/signup-action-core";
import type { SignUpFormState } from "../../lib/signup-form-state";

export async function signUpAction(_previous: SignUpFormState, formData: FormData): Promise<SignUpFormState> {
  const outcome = await runSignUpAction(formData, {
    signUp,
    getContext: getRequestContext,
    setCookie: async (sessionToken) => {
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(process.env.NODE_ENV === "production"));
    },
    now: () => new Date(),
  });

  // runSignUpAction never throws, so there is no try block here. redirect
  // works by stopping the action, which is why it must never sit in one.
  if ("redirectTo" in outcome) {
    redirect(outcome.redirectTo);
  }
  return outcome;
}
