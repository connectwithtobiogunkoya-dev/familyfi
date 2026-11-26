// The sign-up screen, at /sign-up.
//
// When sign-up is switched off, it shows only the FamilyFi name, the
// paused sentence and a link back: no form and no fields. Otherwise it
// shows the sign-up form (sign-up-form.tsx).

import type { Metadata } from "next";
import { connection } from "next/server";

import { signupsEnabled } from "../../lib/settings";
import { SIGNUPS_PAUSED_SENTENCE } from "../../lib/signup-form-state";
import styles from "./page.module.css";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function SignUpPage() {
  // Wait for a real visit, so the switch is read at the moment of the
  // visit and the page is never served from a stored copy.
  await connection();

  if (!signupsEnabled()) {
    return (
      <div className={styles.screen}>
        <h1 className={styles.title}>FamilyFi</h1>
        <p className={styles.notice} role="status">
          {SIGNUPS_PAUSED_SENTENCE}
        </p>
        <a href="/" className={styles.back}>
          ‹ Back to FamilyFi
        </a>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <a href="/" className={styles.back}>
        ‹ Back to FamilyFi
      </a>
      <h1 className={styles.title}>Create your household</h1>
      <p className={styles.notice}>
        This is a test environment. Use test numbers only: 11 digits starting with 000. A number ending in 99 shows a
        failed check.
      </p>
      <SignUpForm />
    </div>
  );
}
