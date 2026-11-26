// What the sign-in form shows after an attempt: shared by the server
// action and the form in the browser.
//
// This file has no imports, so it is safe in the browser. The rules that
// make this state are in lib/signin-action-core.ts.

/** What the form shows after an attempt that did not sign anyone in. */
export type SignInFormState = {
  status: "idle" | "wrong_code" | "too_many_attempts" | "no_household" | "unknown";
  // The one general sentence, from lib/auth-limits.ts, or null.
  message: string | null;
};

/** The form's state before anything is sent. */
export const INITIAL_SIGN_IN_STATE: SignInFormState = { status: "idle", message: null };
