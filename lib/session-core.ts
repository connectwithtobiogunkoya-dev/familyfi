// Recognising the signed-in person, and showing them their access code.
//
// The rules, given the database reads as "deps" so tests can hand in
// stand-ins. lib/session.ts plugs in the real cookie and database and is
// server-only.

import { decryptAccessCode } from "./access-code-crypto.ts";
import type { AccessCodeMaterial, SessionPerson } from "./auth-db-core.ts";
import { looksLikeSessionToken, sessionTokenFingerprint } from "./session-token.ts";

export type { SessionPerson };

/**
 * Who is signed in, given the session cookie's value: the person, or null.
 *
 * A missing cookie, or one that does not look like a token this app made,
 * gives null without asking the database. Otherwise only the token's
 * fingerprint is sent. Any failure gives null: not signed in.
 */
export async function resolveSession(
  cookieValue: unknown,
  getSessionRow: (tokenHash: string) => Promise<SessionPerson | null>,
): Promise<SessionPerson | null> {
  if (!looksLikeSessionToken(cookieValue)) {
    return null;
  }
  try {
    return await getSessionRow(sessionTokenFingerprint(cookieValue));
  } catch {
    return null;
  }
}

export type AccessCodeDeps = {
  getAccessCodeMaterial: (customerId: string) => Promise<AccessCodeMaterial | null>;
  accessCodeKeys: () => ReadonlyMap<number, Buffer> | null;
};

/**
 * The signed-in person's own access code, or null.
 *
 * It is given the person found from the session, never an id chosen by a
 * caller. It reads the locked copy and its key version, finds that key and
 * unlocks it. No person, no locked copy, no key for that version, or a
 * copy that will not unlock: null. Nothing is logged.
 */
export async function readMyAccessCode(person: SessionPerson | null, deps: AccessCodeDeps): Promise<string | null> {
  if (person === null) {
    return null;
  }
  try {
    const material = await deps.getAccessCodeMaterial(person.customerId);
    if (material === null) {
      return null;
    }
    const key = deps.accessCodeKeys()?.get(material.keyVersion);
    if (key === undefined) {
      return null;
    }
    return decryptAccessCode(material.codeEncrypted, key);
  } catch {
    return null;
  }
}
