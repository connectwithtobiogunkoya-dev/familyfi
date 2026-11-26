// Recognising a visitor, for the sign-up and sign-in limits.
//
// A visitor is recognised by their internet address (IP), taken from the
// x-forwarded-for header that Vercel sets itself. Vercel's documentation
// says it overwrites that header rather than passing on a value sent by
// the visitor, to prevent IP spoofing:
//   https://vercel.com/docs/headers/request-headers
// So the leftmost entry is the visitor's real address. No other header is
// ever used for this, x-real-ip included.
//
// The address is never stored. Only a fingerprint of it is, made with a
// secret key: HMAC-SHA256. An internet address counts as personal data,
// and without the key the fingerprint cannot be turned back into one.
//
// This file never reads a setting itself: the key is always passed in.

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * The word used when there is no usable address. Every such request shares
 * this one strict bucket for the limits, so a missing or broken header can
 * never be used to get round them.
 */
export const UNKNOWN_VISITOR = "unknown";

// The longest an IPv6 address can be written (with an IPv4 part at the
// end) is 45 characters.
const MAX_ADDRESS_LENGTH = 45;

// Only the start of the header is looked at, so a huge header costs
// nothing. The leftmost entry always fits well within this.
const MAX_HEADER_READ = 256;

/** Anything that can look up a request header by name, like Next.js headers(). */
export type HeaderSource = { get(name: string): string | null };

/**
 * The visitor's internet address: the leftmost entry of x-forwarded-for,
 * with spaces trimmed, if it is an IPv4 or IPv6 address. Otherwise, or if
 * the header is missing, the fixed word "unknown".
 */
export function visitorAddress(headers: HeaderSource): string {
  const header = headers.get("x-forwarded-for");
  if (typeof header !== "string") {
    return UNKNOWN_VISITOR;
  }

  const leftmost = header.slice(0, MAX_HEADER_READ).split(",")[0].trim();
  if (leftmost.length === 0 || leftmost.length > MAX_ADDRESS_LENGTH || isIP(leftmost) === 0) {
    return UNKNOWN_VISITOR;
  }

  // IPv6 can be written in capitals or small letters; small letters only,
  // so one address always gives one fingerprint.
  return leftmost.toLowerCase();
}

/**
 * The fingerprint of a visitor's address: HMAC-SHA256 with the given key,
 * as 64 lowercase hexadecimal characters. This is what the database
 * stores and counts. An empty key throws, because a fingerprint made
 * without a secret could be worked back to the address.
 */
export function visitorFingerprint(address: string, key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("The visitor fingerprint needs a key, and none was given.");
  }
  if (typeof address !== "string") {
    throw new Error("The visitor fingerprint needs an address as text.");
  }
  return createHmac("sha256", key).update(address, "utf8").digest("hex");
}
