"use client";

// The sign-up form.
//
// This runs in the browser. Every field's value is kept here, in the
// browser, so when the server says a field has a problem the typed
// values stay in place. The server never sends them back: it sends only
// a status, one sentence per field with a problem, and one general
// sentence.
//
// "Fill in test details" fills every field except the test-terms box
// with made-up test values, using the browser's secure random numbers.
// It never sends the form.

import { useActionState, useState } from "react";

import { generateTestDetails, type IdentityField } from "../../lib/identity";
import { generalSentence, INITIAL_SIGN_UP_STATE } from "../../lib/signup-form-state";
import { signUpAction } from "./actions";
import styles from "./page.module.css";
import { SubmitButton } from "./submit-button";

type Values = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  role: "" | "husband" | "wife";
  nin: string;
  bvn: string;
  householdName: string;
};

const EMPTY: Values = { fullName: "", phone: "", dateOfBirth: "", role: "", nin: "", bvn: "", householdName: "" };

// A number from 0 up to (but not including) 1, from the browser's secure
// random number source.
function secureRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, INITIAL_SIGN_UP_STATE);
  const [values, setValues] = useState<Values>(EMPTY);
  const [termsTicked, setTermsTicked] = useState(false);

  function set<K extends keyof Values>(name: K, value: Values[K]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function fillTestDetails() {
    const details = generateTestDetails(secureRandom, new Date());
    setValues({
      fullName: details.fullName,
      phone: details.phone,
      dateOfBirth: details.dateOfBirth,
      role: details.role,
      nin: details.nin,
      bvn: details.bvn,
      householdName: details.householdName,
    });
  }

  // The sentence beside a field, if the server gave one.
  function problem(field: IdentityField) {
    const sentence = state.fields[field];
    return sentence === undefined ? null : (
      <p id={`${field}-problem`} className={styles.problem} role="alert">
        {sentence}
      </p>
    );
  }

  function describedBy(field: IdentityField): string | undefined {
    return state.fields[field] === undefined ? undefined : `${field}-problem`;
  }

  const general = generalSentence(state);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <button type="button" className={styles.secondary} onClick={fillTestDetails}>
        Fill in test details
      </button>

      <label htmlFor="full_name" className={styles.label}>
        Full name
      </label>
      <input
        id="full_name"
        name="full_name"
        type="text"
        autoComplete="off"
        value={values.fullName}
        onChange={(event) => set("fullName", event.target.value)}
        aria-invalid={state.fields.fullName !== undefined}
        aria-describedby={describedBy("fullName")}
        className={styles.input}
      />
      {problem("fullName")}

      <label htmlFor="phone" className={styles.label}>
        Phone
      </label>
      <input
        id="phone"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        value={values.phone}
        onChange={(event) => set("phone", event.target.value)}
        aria-invalid={state.fields.phone !== undefined}
        aria-describedby={describedBy("phone")}
        className={styles.input}
      />
      {problem("phone")}

      <label htmlFor="date_of_birth" className={styles.label}>
        Date of birth
      </label>
      <input
        id="date_of_birth"
        name="date_of_birth"
        type="date"
        autoComplete="off"
        value={values.dateOfBirth}
        onChange={(event) => set("dateOfBirth", event.target.value)}
        aria-invalid={state.fields.dateOfBirth !== undefined}
        aria-describedby={describedBy("dateOfBirth")}
        className={styles.input}
      />
      {problem("dateOfBirth")}

      <fieldset className={styles.roles} aria-label="Husband or Wife" aria-describedby={describedBy("role")}>
        <div className={styles.roleChoices}>
          {(["husband", "wife"] as const).map((role) => (
            <label key={role} className={values.role === role ? `${styles.role} ${styles.roleChosen}` : styles.role}>
              <input
                type="radio"
                name="role"
                value={role}
                checked={values.role === role}
                onChange={() => set("role", role)}
                className={styles.roleInput}
              />
              {role === "husband" ? "Husband" : "Wife"}
            </label>
          ))}
        </div>
      </fieldset>
      {problem("role")}

      <label htmlFor="nin" className={styles.label}>
        NIN
      </label>
      <input
        id="nin"
        name="nin"
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        value={values.nin}
        onChange={(event) => set("nin", event.target.value)}
        aria-invalid={state.fields.nin !== undefined}
        aria-describedby={describedBy("nin")}
        className={styles.input}
      />
      {problem("nin")}

      <label htmlFor="bvn" className={styles.label}>
        BVN
      </label>
      <input
        id="bvn"
        name="bvn"
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        value={values.bvn}
        onChange={(event) => set("bvn", event.target.value)}
        aria-invalid={state.fields.bvn !== undefined}
        aria-describedby={describedBy("bvn")}
        className={styles.input}
      />
      {problem("bvn")}

      <label htmlFor="household_name" className={styles.label}>
        Household name (optional)
      </label>
      <input
        id="household_name"
        name="household_name"
        type="text"
        autoComplete="off"
        value={values.householdName}
        onChange={(event) => set("householdName", event.target.value)}
        aria-invalid={state.fields.householdName !== undefined}
        aria-describedby={describedBy("householdName")}
        className={styles.input}
      />
      {problem("householdName")}

      <label className={styles.terms}>
        <input
          type="checkbox"
          name="terms"
          checked={termsTicked}
          onChange={(event) => setTermsTicked(event.target.checked)}
          aria-describedby={describedBy("testTermsAccepted")}
          className={styles.termsBox}
        />
        <span>I understand this is a test environment: no real money moves, and the identity check is simulated.</span>
      </label>
      {problem("testTermsAccepted")}

      {general !== null ? (
        <p className={styles.error} role="alert">
          {general}
        </p>
      ) : null}

      <SubmitButton className={styles.button} />
    </form>
  );
}
