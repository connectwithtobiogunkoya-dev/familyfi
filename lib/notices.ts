// Confirmation messages shown on /app after money has moved.
//
// The address carries a short code, such as /app?notice=added. Anyone can
// type anything into an address, so only the exact codes below are
// accepted, and each gives one fixed sentence. Text from the address is
// never shown.

import { errorSentence } from "./errors.ts";

/** Every notice there is. */
export const NOTICE_CODES = ["added", "replayed"] as const;

export type NoticeCode = (typeof NOTICE_CODES)[number];

/** The fixed sentence for each notice. */
export function noticeSentence(code: NoticeCode): string {
  switch (code) {
    case "added":
      return "Money added to your wallet.";
    case "replayed":
      // The same words as the "replayed" error code, kept in one place.
      return errorSentence("replayed");
  }
}

/**
 * Read a notice code from the address and give its fixed sentence, or
 * null if the value is not exactly one of the codes above. A list of
 * values, an empty value or anything else gives null.
 */
export function readNotice(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const code of NOTICE_CODES) {
    if (value === code) {
      return noticeSentence(code);
    }
  }
  return null;
}
