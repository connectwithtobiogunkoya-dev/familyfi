// The sign-up form's server action: the rules, in a file tests can load.
//
// app/sign-up/actions.ts is the real action. It plugs in the real
// sign-up, the real request details and the real cookie, and then sends
// the browser to /welcome.
//
// What this does:
//   * Reads only the eight form fields below, by name. Anything else in
//     the form (household, household_id, customer_id, role_id, ...) is
//     never read, so it can never reach the sign-up.
//   * On success: hands the session token to setCookie, exactly once, and
//     says where to go next. The token goes nowhere else.
//   * Otherwise: gives back a small state for the form (see
//     lib/signup-form-state.ts), holding only a status, one sentence per
//     field with a problem, and one general sentence. Never what was
//     typed, never the session token, never an access code, a NIN or a
//     BVN.

import { signUpRefusalSentence } from "./auth-limits.ts";
import type { IdentityField, IdentityInput } from "./identity.ts";
import type { RequestContext } from "./request-context-core.ts";
import type { SignUpContext, SignUpResult } from "./signup-core.ts";
import { SIGNUPS_PAUSED_SENTENCE, type SignUpFormState } from "./signup-form-state.ts";

/** The form fields read, by their names in the form. Nothing else is read. */
export const SIGN_UP_FORM_FIELDS = [
  "full_name",
  "phone",
  "date_of_birth",
  "role",
  "nin",
  "bvn",
  "household_name",
  "terms",
] as const;

export type SignUpActionOutcome = { redirectTo: "/welcome" } | SignUpFormState;

export type SignUpActionDeps = {
  signUp: (rawForm: IdentityInput, context: SignUpContext) => Promise<SignUpResult>;
  getContext: () => Promise<RequestContext>;
  setCookie: (sessionToken: string) => void | Promise<void>;
  now: () => Date;
};

/** Anything with a get(name), such as FormData. */
export type FormSource = { get: (name: string) => unknown };

function tryAgain(): SignUpFormState {
  return { status: "refused", fields: {}, message: signUpRefusalSentence("unknown") };
}

/** Read the eight fields, and nothing else, from the form. */
export function readSignUpForm(form: FormSource): IdentityInput {
  return {
    fullName: form.get("full_name"),
    phone: form.get("phone"),
    dateOfBirth: form.get("date_of_birth"),
    role: form.get("role"),
    nin: form.get("nin"),
    bvn: form.get("bvn"),
    householdName: form.get("household_name"),
    // A ticked checkbox sends "on". Anything else counts as not ticked.
    testTermsAccepted: form.get("terms") === "on",
  };
}

export async function runSignUpAction(form: FormSource, deps: SignUpActionDeps): Promise<SignUpActionOutcome> {
  let result: SignUpResult;
  try {
    const request = await deps.getContext();
    result = await deps.signUp(readSignUpForm(form), {
      address: request.address,
      isDevelopment: request.isDevelopment,
      now: deps.now(),
    });
  } catch {
    return tryAgain();
  }

  switch (result.status) {
    case "ok":
      try {
        await deps.setCookie(result.sessionToken);
      } catch {
        return tryAgain();
      }
      return { redirectTo: "/welcome" };
    case "paused":
      return { status: "paused", fields: {}, message: SIGNUPS_PAUSED_SENTENCE };
    case "field_errors": {
      const fields: Partial<Record<IdentityField, string>> = {};
      for (const [field, error] of Object.entries(result.fields)) {
        if (error !== undefined) {
          fields[field as IdentityField] = error.message;
        }
      }
      return { status: "field_errors", fields, message: null };
    }
    case "not_verified":
      return { status: "not_verified", fields: {}, message: result.message };
    case "refused":
      return { status: "refused", fields: {}, message: result.message };
    default:
      return tryAgain();
  }
}
