// The welcome screen, at /welcome, shown straight after a sign-up.
//
// It is built fresh for every visit and never stored. Only a signed-in
// person sees it, and it shows only their own access code: the person
// comes from this browser's session, never from the address or a form.
// A visitor with no session is sent to /sign-in.
//
// The code appears in this page's HTML and nowhere else: not in the
// address, not in any cookie, not in the browser's storage, and not in
// any log.

import type { Metadata } from "next";
import { connection } from "next/server";

import { formatAccessCode, tidyAccessCode } from "../../lib/access-code";
import { getMyAccessCode, requireSession } from "../../lib/session";
import { AccessCode } from "./access-code";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FamilyFi",
};

// The one sentence shown when something on this page cannot be read. It
// reads correctly for an owner and a partner alike.
const LOAD_FAILED_SENTENCE = "We could not load this right now. Please try again.";

// "View my profile": an outlined link, full width and 52 px tall.
const VIEW_PROFILE_LINK = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "16px 0 0",
  minHeight: "52px",
  padding: "12px 20px",
  border: "2px solid #14532d",
  borderRadius: "12px",
  color: "#14532d",
  fontSize: "1.125rem",
  fontWeight: 700,
  textDecoration: "none",
  boxSizing: "border-box",
} as const;

export default async function WelcomePage() {
  // Wait for a real visit, so this page is never served from a stored copy.
  await connection();

  // No session: a redirect to /sign-in. It works by stopping the page, so
  // it is never inside a try block.
  await requireSession();

  const code = await getMyAccessCode();

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>Identity check passed (simulated).</h1>

      {code === null ? (
        <p className={styles.notice} role="status">
          {LOAD_FAILED_SENTENCE}
        </p>
      ) : (
        <>
          {/* Tidied first, so it always shows as four groups of four. */}
          <AccessCode code={formatAccessCode(tidyAccessCode(code))} />
          <p className={styles.note}>
            Write this down. You will need it to sign in on another phone. You can see it again on your profile.
          </p>
        </>
      )}

      <a href="/app" className={styles.button}>
        Go to my household
      </a>

      <a href="/app/profile" style={VIEW_PROFILE_LINK}>
        View my profile
      </a>
    </div>
  );
}
