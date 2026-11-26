// The session cookie's name and settings.
//
// The browser keeps its session token in one cookie. Page scripts can
// never read it (HttpOnly), it is sent only on visits from this site and
// ordinary links to it (SameSite lax), it covers every page (Path /), and
// it lasts as long as the longest a session can last: 180 days. On the
// live site it is sent only over HTTPS (Secure).

import { AUTH_LIMITS } from "./auth-limits.ts";

export const SESSION_COOKIE_NAME = "familyfi_session";

const SECONDS_PER_DAY = 24 * 60 * 60;

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean;
};

/**
 * The settings for setting the session cookie. "isProduction" is true on
 * the live site, where the cookie must only travel over HTTPS; on a
 * developer's own computer (plain http://localhost) it is false.
 */
export function sessionCookieOptions(isProduction: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_LIMITS.sessionAbsoluteDays * SECONDS_PER_DAY,
    secure: isProduction === true,
  };
}

/**
 * The settings for deleting the session cookie: the same cookie, with no
 * time left, so the browser removes it straight away.
 */
export function deleteSessionCookieOptions(isProduction: boolean): SessionCookieOptions {
  return { ...sessionCookieOptions(isProduction), maxAge: 0 };
}
