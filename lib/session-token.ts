// Session tokens for FamilyFi.
//
// When someone signs in, their browser is given a random token in a
// cookie. The database never sees the token itself, only its fingerprint,
// so a copy of the database cannot be used to sign in as anyone.
//
// This file only makes, checks and fingerprints tokens. It never talks to
// the database and never reads a secret.

import { createHash, randomBytes } from "node:crypto";

// 32 random bytes = 256 random bits.
const TOKEN_BYTES = 32;

// 32 bytes written as base64url, with no padding, is always 43 characters.
const TOKEN_LENGTH = 43;

/**
 * Make a new session token: 32 random bytes from node:crypto, written as
 * base64url (letters, digits, "-" and "_"), 43 characters long. This is
 * what goes in the cookie.
 */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Does this look like a token this app made? Exactly 43 base64url
 * characters that are the exact writing of 32 bytes. Anything else, such
 * as an empty cookie, a short one or one with other characters, gives
 * false. It never throws.
 */
export function looksLikeSessionToken(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== TOKEN_LENGTH) {
    return false;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return false;
  }
  // Only one way of writing 32 bytes is accepted, so the same token can
  // never arrive spelled two ways.
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === TOKEN_BYTES && bytes.toString("base64url") === value;
}

/**
 * The fingerprint of a token: SHA-256 of its text, as 64 lowercase
 * hexadecimal characters. This is what the database stores and looks up.
 */
export function sessionTokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
