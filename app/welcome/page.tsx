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
import { signUpRefusalSentence } from "../../lib/auth-limits";
import { getMyAccessCode, requireSession } from "../../lib/session";
import { AccessCode } from "./access-code";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FamilyFi",
};

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
          {signUpRefusalSentence("unknown")}
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
    </div>
  );
}
