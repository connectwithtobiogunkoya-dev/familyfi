"use server";

// The server action behind the sign-in form.
//
// "use server" means this runs only on the server. Next.js's own checks
// for server actions (such as refusing a request from another site) stay
// exactly as they are.
//
// The rules are in lib/signin-action-core.ts. This file plugs in the real
// sign-in, the real request details and the real cookie. The session
// token goes only into the cookie: what this returns to the browser is a
// status and one fixed sentence.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getRequestContext } from "../../lib/request-context";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../../lib/session-cookie";
import { signIn } from "../../lib/signin";
import { runSignInAction } from "../../lib/signin-action-core";
import type { SignInFormState } from "../../lib/signin-form-state";

export async function signInAction(_previous: SignInFormState, formData: FormData): Promise<SignInFormState> {
  const outcome = await runSignInAction(formData, {
    signIn,
    getContext: getRequestContext,
    setCookie: async (sessionToken) => {
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(process.env.NODE_ENV === "production"));
    },
  });

  // runSignInAction never throws, so there is no try block here. redirect
  // works by stopping the action, which is why it must never sit in one.
  if ("redirectTo" in outcome) {
    redirect(outcome.redirectTo);
  }
  return outcome;
}
