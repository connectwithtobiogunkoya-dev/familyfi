// Locking and unlocking access codes for FamilyFi.
//
// The database never holds a person's access code as it is. It holds a
// fingerprint (for signing in) and a locked copy (so the code can be shown
// to its owner again). This file makes and opens that locked copy.
//
// How it is locked: AES-256-GCM, with a 32-byte key that only the server
// holds. Every time a code is locked, a fresh random 96-bit starting value
// (the IV) is used, so the same code locked twice gives two different
// texts. GCM also adds a 16-byte authentication tag: if a single bit of
// the locked copy is changed, or the wrong key is used, unlocking fails.
//
// The locked copy is one text value, three parts joined by full stops,
// each part written in base64url (letters, digits, "-" and "_"):
//
//   <IV, 16 characters>.<locked code>.<tag, 22 characters>
//
// There is no version marker in the text. Which key locked it is kept in
// its own database column, key_version.
//
// Any problem gives one fixed error message with no detail: it never
// contains the code, the key or the locked text.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// base64url lengths, with no padding: 12 bytes -> 16 characters,
// 16 bytes -> 22 characters.
const IV_TEXT_LENGTH = 16;
const TAG_TEXT_LENGTH = 22;

// An access code is short; anything much longer is not one of ours.
const MAX_LOCKED_LENGTH = 512;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

const KEY_ERROR = "The access code key must be exactly 32 bytes.";
const UNLOCK_ERROR = "The access code could not be unlocked.";
const LOCK_ERROR = "The access code could not be locked.";

function checkKey(key: unknown): asserts key is Buffer {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error(KEY_ERROR);
  }
}

// Read one base64url part. Only the one exact way of writing the bytes is
// accepted: base64url can write the same bytes with different last
// characters, and accepting only one means any change to the text is
// noticed.
function readPart(part: string): Buffer | null {
  if (part.length === 0 || !BASE64URL.test(part)) {
    return null;
  }
  const bytes = Buffer.from(part, "base64url");
  return bytes.toString("base64url") === part ? bytes : null;
}

/**
 * Lock an access code with the server's key. Returns the locked copy as
 * one text value: "<IV>.<locked code>.<tag>", each part base64url.
 */
export function encryptAccessCode(code: string, key: Buffer): string {
  checkKey(key);
  if (typeof code !== "string" || code.length === 0) {
    throw new Error(LOCK_ERROR);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const locked = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), locked.toString("base64url"), tag.toString("base64url")].join(".");
}

/**
 * Unlock a locked copy with the server's key and return the access code.
 *
 * Throws one fixed error, with no detail, if the text is not in the right
 * form, is too short or too long, has been changed in any way, or was
 * locked with a different key.
 */
export function decryptAccessCode(locked: string, key: Buffer): string {
  checkKey(key);
  if (typeof locked !== "string" || locked.length === 0 || locked.length > MAX_LOCKED_LENGTH) {
    throw new Error(UNLOCK_ERROR);
  }

  const parts = locked.split(".");
  if (parts.length !== 3 || parts[0].length !== IV_TEXT_LENGTH || parts[2].length !== TAG_TEXT_LENGTH) {
    throw new Error(UNLOCK_ERROR);
  }

  const iv = readPart(parts[0]);
  const body = readPart(parts[1]);
  const tag = readPart(parts[2]);
  if (iv === null || body === null || tag === null || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error(UNLOCK_ERROR);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // The tag did not match: the text was changed, or the key is wrong.
    // The underlying error is not passed on.
    throw new Error(UNLOCK_ERROR);
  }
}
