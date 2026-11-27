// The Join form's server action: the rules, in a file tests can load. The
// real action (app/join/actions.ts) comes in a later step and will plug in
// the real join, the real request details and the real cookie, exactly as
// app/sign-up/actions.ts does.
//
// What this does:
//   * Reads only the eight form fields below, by name. Anything else in
//     the form (household, household_id, customer_id, ...) is never read.
//   * On "joined": hands the session token to setCookie, exactly once,
//     and says where to go next: /welcome, which shows the partner their
//     own access code.
//   * Otherwise: gives back only a status, one sentence per field with a
//     problem, and one general sentence. Never what was typed, never the
//     invite code, a fingerprint, an id, the session token or an access
//     code.

import type { IdentityField } from "./identity.ts";
import { joinSentence } from "./invite-rules.ts";
import type { JoinContext, JoinInput, JoinResult } from "./join-core.ts";
import type { JoinFormState } from "./join-form-state.ts";
import type { RequestContext } from "./request-context-core.ts";

/** The form fields read, by their names in the form. Nothing else is read. */
export const JOIN_FORM_FIELDS = [
  "invite_code",
  "full_name",
  "phone",
  "date_of_birth",
  "role",
  "nin",
  "bvn",
  "terms",
] as const;

export type JoinActionOutcome = { redirectTo: "/welcome" } | JoinFormState;

export type JoinActionDeps = {
  join: (rawForm: JoinInput, context: JoinContext) => Promise<JoinResult>;
  getContext: () => Promise<RequestContext>;
  setCookie: (sessionToken: string) => void | Promise<void>;
  now: () => Date;
};

/** Anything with a get(name), such as FormData. */
export type FormSource = { get: (name: string) => unknown };

function tryAgain(): JoinFormState {
  return { status: "refused", fields: {}, message: joinSentence("unknown") };
}

/** Read the eight fields, and nothing else, from the form. */
export function readJoinForm(form: FormSource): JoinInput {
  return {
    inviteCode: form.get("invite_code"),
    fullName: form.get("full_name"),
    phone: form.get("phone"),
    dateOfBirth: form.get("date_of_birth"),
    role: form.get("role"),
    nin: form.get("nin"),
    bvn: form.get("bvn"),
    // A ticked checkbox sends "on". Anything else counts as not ticked.
    testTermsAccepted: form.get("terms") === "on",
  };
}

export async function runJoinAction(form: FormSource, deps: JoinActionDeps): Promise<JoinActionOutcome> {
  let result: JoinResult;
  try {
    const request = await deps.getContext();
    result = await deps.join(readJoinForm(form), {
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
      return { status: "paused", fields: {}, message: result.message };
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
      // The sentence is looked up again from the code, so nothing else the
      // join gave back can come through.
      return { status: "refused", fields: {}, message: joinSentence(result.code) };
    default:
      return tryAgain();
  }
}
