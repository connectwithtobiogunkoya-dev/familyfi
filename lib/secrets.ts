// FamilyFi's Slice 5 secrets: the server-only front door.
//
// getAccessCodeKeys and getVisitorKey read the real server settings each
// time they are called (never when the file is first loaded), and check
// them with lib/secrets-core.ts. They must never reach a visitor's browser.
//
// FAIL CLOSED. When either returns null, the caller must not crash and
// must not show any detail. It shows one plain sentence instead:
//   * on sign-up:  signUpRefusalSentence("unknown") from lib/auth-limits.ts,
//                  "We could not create your household right now. Please
//                  try again later."
//   * on sign-in:  signInSentence("unknown") from lib/auth-limits.ts,
//                  "We could not sign you in right now. Please try again
//                  later."
//   * on /welcome and /app/profile, where the access code is shown:
//                  "Your access code cannot be shown right now."
// The server log may name the missing setting, never its value.
import "server-only";

import { CURRENT_KEY_VERSION, readAccessCodeKeys, readVisitorKey } from "./secrets-core.ts";

export { CURRENT_KEY_VERSION };

/** The access code keys by version ({1: key}), or null if the setting is missing or bad. */
export function getAccessCodeKeys(): ReadonlyMap<number, Buffer> | null {
  return readAccessCodeKeys({ ACCESS_CODE_ENCRYPTION_KEY: process.env.ACCESS_CODE_ENCRYPTION_KEY });
}

/** The visitor fingerprint key, or null if the setting is missing or bad. */
export function getVisitorKey(): string | null {
  return readVisitorKey({ VISITOR_HASH_KEY: process.env.VISITOR_HASH_KEY });
}
