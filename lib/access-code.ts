// Access codes for FamilyFi.
//
// Each person gets one access code, which is how they sign back in. It is
// 16 characters from the Crockford base-32 alphabet, shown in four groups:
//
//   K7QM-3XPD-9RTA-W2FH
//
// The alphabet leaves out I, L, O and U, so no character can be mistaken
// for another. 16 characters of 5 random bits each is 80 random bits:
// guessing one is not realistic.
//
// This file only makes, tidies and fingerprints codes. It never talks to
// the database and never reads a secret.

import { createHash, randomBytes } from "node:crypto";

/** The 32 characters a code is made from. */
export const ACCESS_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many characters a code has, without the hyphens. */
export const ACCESS_CODE_LENGTH = 16;

// Typed text is cut to this length before anything else is done with it,
// so a very long paste costs nothing to handle.
const MAX_TYPED_LENGTH = 64;

// 16 characters x 5 bits = 80 bits = exactly 10 random bytes.
const RANDOM_BYTES_NEEDED = (ACCESS_CODE_LENGTH * 5) / 8;

/**
 * Make a new access code, shown in four groups: "K7QM-3XPD-9RTA-W2FH".
 *
 * Each character uses exactly 5 random bits, so every character of the
 * alphabet is equally likely (no character is favoured).
 *
 * The random source can be replaced in tests; it defaults to node:crypto's
 * randomBytes, which is suitable for secrets.
 */
export function generateAccessCode(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(RANDOM_BYTES_NEEDED);
  if (bytes.length !== RANDOM_BYTES_NEEDED) {
    throw new Error("The random source gave the wrong number of bytes.");
  }

  // Read the 80 bits five at a time, from the first byte onwards.
  let characters = "";
  let buffer = 0;
  let bitsInBuffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      characters += ACCESS_CODE_ALPHABET[(buffer >> bitsInBuffer) & 31];
    }
    // Keep only the bits not yet used, so the number never grows large.
    buffer &= (1 << bitsInBuffer) - 1;
  }

  return formatAccessCode(characters);
}

/** Show 16 characters in four groups of four: "K7QM3XPD9RTAW2FH" -> "K7QM-3XPD-9RTA-W2FH". */
export function formatAccessCode(characters: string): string {
  return [0, 4, 8, 12].map((start) => characters.slice(start, start + 4)).join("-");
}

/**
 * Tidy what a person typed into the shape codes are stored in.
 *
 *   * Cut to 64 characters first, before anything else.
 *   * Capitals and small letters count the same.
 *   * Spaces and hyphens are ignored.
 *   * O is read as 0, and I or L as 1, because those letters are not in
 *     the alphabet and are easy to type by mistake.
 *
 * Whatever comes out is used, even if it is not a proper code: sign-in
 * always fingerprints and sends it, so a wrong guess is always counted.
 * Anything that is not text gives an empty string.
 */
export function tidyAccessCode(typed: unknown): string {
  if (typeof typed !== "string") {
    return "";
  }
  return typed
    .slice(0, MAX_TYPED_LENGTH)
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/**
 * Does the typed text look like a code: exactly 16 characters from the
 * alphabet, once tidied?
 *
 * For the sign-in form only, to help the person spot a typing mistake.
 * It must never be used to skip sending a code to the database: a badly
 * formed guess still has to be counted.
 */
export function looksLikeAccessCode(typed: unknown): boolean {
  const tidied = tidyAccessCode(typed);
  if (tidied.length !== ACCESS_CODE_LENGTH) {
    return false;
  }
  for (const character of tidied) {
    if (!ACCESS_CODE_ALPHABET.includes(character)) {
      return false;
    }
  }
  return true;
}

/**
 * The fingerprint of a code: SHA-256 of the tidied text, as 64 lowercase
 * hexadecimal characters. This is what the database stores and looks up.
 *
 * It works on anything typed, proper code or not, so every sign-in attempt
 * can be sent to the database and counted.
 */
export function accessCodeFingerprint(typed: unknown): string {
  return createHash("sha256").update(tidyAccessCode(typed), "utf8").digest("hex");
}
