// What the sign-up form shows after an attempt: shared by the server
// action and the form in the browser.
//
// This file has no imports that run code, so it is safe in the browser.
// The rules that make this state are in lib/signup-action-core.ts.

import type { IdentityField } from "./identity.ts";

/** The one approved sentence for when sign-up is switched off. */
export const SIGNUPS_PAUSED_SENTENCE = "New sign-ups are paused right now.";

/** What the form shows after an attempt that did not sign anyone up. */
export type SignUpFormState = {
  status: "idle" | "paused" | "field_errors" | "not_verified" | "refused";
  // One sentence for each field with a problem, keyed by field.
  fields: Partial<Record<IdentityField, string>>;
  // One sentence for anything that is not a field problem, or null.
  message: string | null;
};

/** The form's state before anything is sent. */
export const INITIAL_SIGN_UP_STATE: SignUpFormState = { status: "idle", fields: {}, message: null };

/**
 * The one general sentence the form shows above its button, or null.
 * Field problems show only beside their fields, so they give null.
 */
export function generalSentence(state: SignUpFormState): string | null {
  if (state.status === "idle" || state.status === "field_errors") {
    return null;
  }
  return state.message;
}
