// The signed-in person: the server-only front door.
//
//   getSession()       who is signed in on this browser, or null
//   requireSession()   the same, or a redirect to /sign-in
//   getMyAccessCode()  the signed-in person's own access code, or null
//
// The rules are in lib/session-core.ts. This file reads the real cookie
// (cookies() is async in this version of Next.js) and the real database.
import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAccessCodeMaterial, getSessionRow } from "./auth-db.ts";
import { getAccessCodeKeys } from "./secrets.ts";
import { SESSION_COOKIE_NAME } from "./session-cookie.ts";
import { readMyAccessCode, resolveSession, type SessionPerson } from "./session-core.ts";

/**
 * Who is signed in on this browser, or null. Wrapped in React's cache, so
 * however many times one request asks, the database is asked once.
 */
export const getSession = cache(async (): Promise<SessionPerson | null> => {
  const cookieStore = await cookies();
  return resolveSession(cookieStore.get(SESSION_COOKIE_NAME)?.value, getSessionRow);
});

/**
 * The signed-in person, or a redirect to /sign-in. The redirect works by
 * stopping the page, so it is never inside a try block.
 */
export async function requireSession(): Promise<SessionPerson> {
  const session = await getSession();
  if (session === null) {
    redirect("/sign-in");
  }
  return session;
}

/**
 * The signed-in person's own access code, or null. It takes no id: the
 * person always comes from this browser's session.
 */
export async function getMyAccessCode(): Promise<string | null> {
  return readMyAccessCode(await getSession(), {
    getAccessCodeMaterial,
    accessCodeKeys: getAccessCodeKeys,
  });
}
