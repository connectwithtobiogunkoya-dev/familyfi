// The Join page, at /join, for a partner joining a household with an
// invite code.
//
// It mirrors /sign-up. When sign-up is switched off (SIGNUPS_ENABLED, which
// also gates joining), it shows only the FamilyFi name, the paused sentence
// and a link back: no form and no fields. Otherwise it shows the Join form
// (join-form.tsx). Like /sign-up, it does not read the session.

import type { Metadata } from "next";
import { connection } from "next/server";

import { signupsEnabled } from "../../lib/settings";
import { SIGNUPS_PAUSED_SENTENCE } from "../../lib/signup-form-state";
import styles from "../sign-up/page.module.css";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function JoinPage() {
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
      <h1 className={styles.title}>Join a household</h1>
      <p className={styles.notice}>
        Ask your partner for their invite code. This is a test environment. Use test numbers only: 11 digits starting
        with 000. A number ending in 99 shows a failed check.
      </p>
      <JoinForm />
    </div>
  );
}
