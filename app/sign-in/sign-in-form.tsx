"use client";

// The sign-in form.
//
// This runs in the browser. The typed code is kept here, so it stays in
// the box after a refusal. The server never sends it back: it sends only
// a status and one fixed sentence.

import { useActionState, useState } from "react";

import { INITIAL_SIGN_IN_STATE } from "../../lib/signin-form-state";
import { signInAction } from "./actions";
import styles from "./page.module.css";
import { SubmitButton } from "./submit-button";

export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, INITIAL_SIGN_IN_STATE);
  const [code, setCode] = useState("");

  return (
    <form action={formAction} className={styles.form}>
      <label htmlFor="access_code" className={styles.label}>
        Access code
      </label>
      <input
        id="access_code"
        name="access_code"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        aria-invalid={state.message !== null}
        aria-describedby={state.message !== null ? "sign-in-problem" : undefined}
        className={styles.input}
      />

      {state.message !== null ? (
        <p id="sign-in-problem" className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton className={styles.button} />
    </form>
  );
}
