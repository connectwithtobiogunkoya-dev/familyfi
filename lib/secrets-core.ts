// Reading FamilyFi's two Slice 5 secrets from a set of settings.
//
// This file does the checking. It is given the settings to read, so tests
// can hand it stand-in settings and never touch the real ones. The real
// settings are read by lib/secrets.ts, which is server-only.
//
// Both secrets must be exactly 64 hexadecimal characters (32 bytes):
//   ACCESS_CODE_ENCRYPTION_KEY  the key that locks access codes
//   VISITOR_HASH_KEY            the key for visitor fingerprints
//
// A missing or badly formed secret gives null, never an error, and nothing
// returned ever contains the setting's value. The caller must then fail
// closed: refuse with a plain sentence, without crashing.

/** The version of ACCESS_CODE_ENCRYPTION_KEY in use. Stored with each locked code. */
export const CURRENT_KEY_VERSION = 1;

/** The settings these functions read. Anything else in them is ignored. */
export type SecretSettings = {
  ACCESS_CODE_ENCRYPTION_KEY?: string;
  VISITOR_HASH_KEY?: string;
};

const SIXTY_FOUR_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * The access code keys, by key version: a map with one entry, version 1,
 * holding ACCESS_CODE_ENCRYPTION_KEY as 32 bytes. Gives null if the
 * setting is missing or is not exactly 64 hexadecimal characters.
 */
export function readAccessCodeKeys(settings: SecretSettings): ReadonlyMap<number, Buffer> | null {
  const value = settings.ACCESS_CODE_ENCRYPTION_KEY;
  if (typeof value !== "string" || !SIXTY_FOUR_HEX.test(value)) {
    return null;
  }
  return new Map([[CURRENT_KEY_VERSION, Buffer.from(value, "hex")]]);
}

/**
 * The visitor fingerprint key: VISITOR_HASH_KEY as given. Gives null if
 * the setting is missing or is not exactly 64 hexadecimal characters.
 */
export function readVisitorKey(settings: SecretSettings): string | null {
  const value = settings.VISITOR_HASH_KEY;
  if (typeof value !== "string" || !SIXTY_FOUR_HEX.test(value)) {
    return null;
  }
  return value;
}
