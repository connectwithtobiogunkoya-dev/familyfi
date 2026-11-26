"use client";

// The "Sign out" button.
//
// It sits on the profile screen, /app/profile.
//
// It switches itself off while the request is being sent, so a second tap
// does nothing.

import { useFormStatus } from "react-dom";

import { signOutAction } from "../../sign-out/actions";
import styles from "./sign-out-button.module.css";

function Button() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.button} disabled={pending} aria-disabled={pending}>
      Sign out
    </button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction} className={styles.form}>
      <Button />
    </form>
  );
}
