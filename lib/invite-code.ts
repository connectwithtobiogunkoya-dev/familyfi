// Invite codes for FamilyFi.
//
// The owner of a household creates a one-time invite code and sends it to
// their partner. It has exactly the shape of an access code: 16 characters
// from the Crockford base-32 alphabet, shown in four groups:
//
//   4HQX-7MRT-2KPD-9WVA
//
// So this file reuses the access code's maker and tidying (lib/access-code.ts)
// rather than repeating them.
//
//   * The fingerprint is SHA-256 of the tidied text, as 64 lowercase
//     hexadecimal characters, exactly like an access code's. A test pins
//     the two together so they can never drift apart.
//   * The locked copy uses the same AES-256-GCM locking and the same key,
//     ACCESS_CODE_ENCRYPTION_KEY (lib/access-code-crypto.ts). No new secret.
//     The hyphenated form is locked, and shown formatted.
//
// This file never talks to the database, never reads a secret and never
// logs anything.

import { createHash } from "node:crypto";

import { formatAccessCode, generateAccessCode, tidyAccessCode } from "./access-code.ts";
import { decryptAccessCode, encryptAccessCode } from "./access-code-crypto.ts";

/** A new invite code, in four groups: "4HQX-7MRT-2KPD-9WVA". */
export function generateInviteCode(random?: (size: number) => Uint8Array): string {
  return random === undefined ? generateAccessCode() : generateAccessCode(random);
}

/** Tidy what a person typed, exactly as an access code is tidied. */
export function tidyInviteCode(typed: unknown): string {
  return tidyAccessCode(typed);
}

/**
 * The fingerprint of an invite code: SHA-256 of the tidied text, as 64
 * lowercase hexadecimal characters. It works on anything typed, so every
 * attempt to join can be sent to the database and counted.
 */
export function inviteCodeFingerprint(typed: unknown): string {
  return createHash("sha256").update(tidyInviteCode(typed), "utf8").digest("hex");
}

/** Show an invite code in four groups, whatever form it was in. */
export function formatInviteCode(code: string): string {
  return formatAccessCode(tidyInviteCode(code));
}

/** Lock an invite code with the server's key. The hyphenated form is locked. */
export function lockInviteCode(code: string, key: Buffer): string {
  return encryptAccessCode(formatInviteCode(code), key);
}

/** Unlock a locked invite code. Throws a fixed error, with no detail, if it cannot. */
export function unlockInviteCode(locked: string, key: Buffer): string {
  return decryptAccessCode(locked, key);
}
