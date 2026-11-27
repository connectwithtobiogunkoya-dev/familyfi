// What the Join form shows after an attempt: shared by the server action
// and the form in the browser (both in a later step).
//
// This file has no imports that run code, so it is safe in the browser.
// The rules that make this state are in lib/join-action-core.ts.

import type { IdentityField } from "./identity.ts";

/** What the form shows after an attempt that did not join anyone. */
export type JoinFormState = {
  status: "idle" | "paused" | "field_errors" | "not_verified" | "refused";
  // One sentence for each field with a problem, keyed by field.
  fields: Partial<Record<IdentityField, string>>;
  // One sentence for anything that is not a field problem, or null.
  message: string | null;
};

/** The form's state before anything is sent. */
export const INITIAL_JOIN_STATE: JoinFormState = { status: "idle", fields: {}, message: null };

/**
 * The one general sentence the form shows above its button, or null.
 * Field problems show only beside their fields, so they give null.
 */
export function joinGeneralSentence(state: JoinFormState): string | null {
  if (state.status === "idle" || state.status === "field_errors") {
    return null;
  }
  return state.message;
}
