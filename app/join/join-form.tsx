"use client";

// The Join form, for a partner joining with an invite code.
//
// This runs in the browser. The typed values, the invite code included,
// are kept here, so they stay in place after a refusal. The server never
// sends any of them back: it sends only a status, one sentence per field
// with a problem, and one general sentence. A wrong, used, expired or
// voided invite, or a full household, all give the same general sentence.
//
// The person's details and the test-terms box are the same shared pieces
// the sign-up form uses. There is no household name: the partner joins a
// household that already has one.
//
// "Fill in test details" fills the person's details with made-up test
// values. It does not fill the invite code or the test-terms box, and it
// never sends the form.

import { useActionState, useState } from "react";

import { generateTestDetails } from "../../lib/identity";
import { INITIAL_JOIN_STATE, joinGeneralSentence } from "../../lib/join-form-state";
import { EMPTY_PERSON, PersonFields, secureRandom, TermsField, type PersonValues } from "../sign-up/identity-fields";
import styles from "../sign-up/page.module.css";
import { joinAction } from "./actions";
import { SubmitButton } from "./submit-button";

export function JoinForm() {
  const [state, formAction] = useActionState(joinAction, INITIAL_JOIN_STATE);
  const [inviteCode, setInviteCode] = useState("");
  const [person, setPerson] = useState<PersonValues>(EMPTY_PERSON);
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
  }

  const general = joinGeneralSentence(state);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <button type="button" className={styles.secondary} onClick={fillTestDetails}>
        Fill in test details
      </button>

      <label htmlFor="invite_code" className={styles.label}>
        Invite code
      </label>
      <input
        id="invite_code"
        name="invite_code"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={inviteCode}
        onChange={(event) => setInviteCode(event.target.value)}
        className={styles.input}
      />

      <PersonFields values={person} onChange={setField} problems={state.fields} />

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
