// The sign-in screen, at /sign-in.
//
// One box for the access code, a "Sign in" button, and a link to create a
// household instead. It is built fresh for every visit and never stored.

import type { Metadata } from "next";
import { connection } from "next/server";

import styles from "./page.module.css";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function SignInPage() {
  // Wait for a real visit, so the page is never served from a stored copy.
  await connection();

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>Sign in</h1>
      <SignInForm />
      <a href="/sign-up" className={styles.link}>
        Create your household
      </a>
      <a href="/join" className={styles.inviteLink}>
        I have an invite code
      </a>
    </div>
  );
}
