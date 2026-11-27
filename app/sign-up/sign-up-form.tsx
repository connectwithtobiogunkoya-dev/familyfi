"use client";

// The sign-up form.
//
// This runs in the browser. Every field's value is kept here, in the
// browser, so when the server says a field has a problem the typed
// values stay in place. The server never sends them back: it sends only
// a status, one sentence per field with a problem, and one general
// sentence.
//
// The person's details and the test-terms box are the shared pieces in
// identity-fields.tsx, which the Join form uses too. The household name
// is asked for only here.
//
// "Fill in test details" fills every field except the test-terms box
// with made-up test values, using the browser's secure random numbers.
// It never sends the form.

import { useActionState, useState } from "react";

import { generateTestDetails } from "../../lib/identity";
import { generalSentence, INITIAL_SIGN_UP_STATE } from "../../lib/signup-form-state";
import { signUpAction } from "./actions";
import { describedBy, EMPTY_PERSON, FieldProblem, PersonFields, secureRandom, TermsField, type PersonValues } from "./identity-fields";
import styles from "./page.module.css";
import { SubmitButton } from "./submit-button";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, INITIAL_SIGN_UP_STATE);
  const [person, setPerson] = useState<PersonValues>(EMPTY_PERSON);
  const [householdName, setHouseholdName] = useState("");
  const [termsTicked, setTermsTicked] = useState(false);

  function setField<K extends keyof PersonValues>(name: K, value: PersonValues[K]) {
    setPerson((current) => ({ ...current, [name]: value }));
  }

  function fillTestDetails() {
    const details = generateTestDetails(secureRandom, new Date());
    setPerson({
      fullName: details.fullName,
      phone: details.phone,
      dateOfBirth: details.dateOfBirth,
      role: details.role,
      nin: details.nin,
      bvn: details.bvn,
    });
    setHouseholdName(details.householdName);
  }

  const general = generalSentence(state);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <button type="button" className={styles.secondary} onClick={fillTestDetails}>
        Fill in test details
      </button>

      <PersonFields values={person} onChange={setField} problems={state.fields} />

      <label htmlFor="household_name" className={styles.label}>
        Household name (optional)
      </label>
      <input
        id="household_name"
        name="household_name"
        type="text"
        autoComplete="off"
        value={householdName}
        onChange={(event) => setHouseholdName(event.target.value)}
        aria-invalid={state.fields.householdName !== undefined}
        aria-describedby={describedBy("householdName", state.fields)}
        className={styles.input}
      />
      <FieldProblem field="householdName" problems={state.fields} />

      <TermsField ticked={termsTicked} onChange={setTermsTicked} problems={state.fields} />

      {general !== null ? (
        <p className={styles.error} role="alert">
          {general}
        </p>
      ) : null}

      <SubmitButton className={styles.button} />
    </form>
  );
}
