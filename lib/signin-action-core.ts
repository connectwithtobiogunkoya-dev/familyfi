// The sign-in form's server action: the rules, in a file tests can load.
//
// app/sign-in/actions.ts is the real action. It plugs in the real
// sign-in, the real request details and the real cookie, and then sends
// the browser to /app.
//
// What this does:
//   * Reads only the form field named access_code. Anything else in the
//     form is never read.
//   * Passes whatever was typed to the sign-in as it is, even if it is not
//     a proper code, so every guess is counted.
//   * On success: hands the session token to setCookie, exactly once, and
//     says where to go next. The token goes nowhere else.
//   * Otherwise: gives back only a status and one fixed sentence. Never
//     the typed code, its tidied form, its fingerprint or the token.

import { signInSentence } from "./auth-limits.ts";
import type { RequestContext } from "./request-context-core.ts";
import type { SignInContext, SignInResult } from "./signin-core.ts";
import type { SignInFormState } from "./signin-form-state.ts";

export type SignInActionOutcome = { redirectTo: "/app" } | SignInFormState;

export type SignInActionDeps = {
  signIn: (typedCode: unknown, context: SignInContext) => Promise<SignInResult>;
  getContext: () => Promise<RequestContext>;
  setCookie: (sessionToken: string) => void | Promise<void>;
};

/** Anything with a get(name), such as FormData. */
export type FormSource = { get: (name: string) => unknown };

function tryAgain(): SignInFormState {
  return { status: "unknown", message: signInSentence("unknown") };
}

export async function runSignInAction(form: FormSource, deps: SignInActionDeps): Promise<SignInActionOutcome> {
  let result: SignInResult;
  try {
    const request = await deps.getContext();
    result = await deps.signIn(form.get("access_code"), { address: request.address });
  } catch {
    return tryAgain();
  }

  if (result.status === "ok") {
    try {
      await deps.setCookie(result.sessionToken);
    } catch {
      return tryAgain();
    }
    return { redirectTo: "/app" };
  }

  // Only the reason and its fixed sentence; the sentence is looked up
  // again here so nothing else the sign-in returned can come back.
  return { status: result.reason, message: signInSentence(result.reason) };
}
