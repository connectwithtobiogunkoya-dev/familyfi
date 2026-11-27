// The person's details and the test-terms box: shared by the sign-up form
// and the Join form, so both ask for them in exactly the same way.
//
// These pieces hold no state of their own. Each form keeps the typed
// values in the browser and passes them in, with the one sentence for each
// field the server said has a problem. The server never sends the typed
// values back.

import type { IdentityField } from "../../lib/identity";
import styles from "./page.module.css";

/** The details both forms ask for. */
export type PersonValues = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  role: "" | "husband" | "wife";
  nin: string;
  bvn: string;
};

export const EMPTY_PERSON: PersonValues = { fullName: "", phone: "", dateOfBirth: "", role: "", nin: "", bvn: "" };

/**
 * A number from 0 up to (but not including) 1, from the browser's secure
 * random number source. For the "Fill in test details" button.
 */
export function secureRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

type Problems = Partial<Record<IdentityField, string>>;

/** The sentence beside a field, if the server gave one. */
export function FieldProblem({ field, problems }: { field: IdentityField; problems: Problems }) {
  const sentence = problems[field];
  return sentence === undefined ? null : (
    <p id={`${field}-problem`} className={styles.problem} role="alert">
      {sentence}
    </p>
  );
}

/** The id of a field's problem sentence, for aria-describedby, or nothing. */
export function describedBy(field: IdentityField, problems: Problems): string | undefined {
  return problems[field] === undefined ? undefined : `${field}-problem`;
}

/** Full name, phone, date of birth, Husband or Wife, NIN and BVN. */
export function PersonFields({
  values,
  onChange,
  problems,
}: {
  values: PersonValues;
  onChange: <K extends keyof PersonValues>(name: K, value: PersonValues[K]) => void;
  problems: Problems;
}) {
  return (
    <>
      <label htmlFor="full_name" className={styles.label}>
        Full name
      </label>
      <input
        id="full_name"
        name="full_name"
        type="text"
        autoComplete="off"
        value={values.fullName}
        onChange={(event) => onChange("fullName", event.target.value)}
        aria-invalid={problems.fullName !== undefined}
        aria-describedby={describedBy("fullName", problems)}
        className={styles.input}
      />
      <FieldProblem field="fullName" problems={problems} />

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
        onChange={(event) => onChange("phone", event.target.value)}
        aria-invalid={problems.phone !== undefined}
        aria-describedby={describedBy("phone", problems)}
        className={styles.input}
      />
      <FieldProblem field="phone" problems={problems} />

      <label htmlFor="date_of_birth" className={styles.label}>
        Date of birth
      </label>
      <input
        id="date_of_birth"
        name="date_of_birth"
        type="date"
        autoComplete="off"
        value={values.dateOfBirth}
        onChange={(event) => onChange("dateOfBirth", event.target.value)}
        aria-invalid={problems.dateOfBirth !== undefined}
        aria-describedby={describedBy("dateOfBirth", problems)}
        className={styles.input}
      />
      <FieldProblem field="dateOfBirth" problems={problems} />

      <fieldset className={styles.roles} aria-label="Husband or Wife" aria-describedby={describedBy("role", problems)}>
        <div className={styles.roleChoices}>
          {(["husband", "wife"] as const).map((role) => (
            <label key={role} className={values.role === role ? `${styles.role} ${styles.roleChosen}` : styles.role}>
              <input
                type="radio"
                name="role"
                value={role}
                checked={values.role === role}
                onChange={() => onChange("role", role)}
                className={styles.roleInput}
              />
              {role === "husband" ? "Husband" : "Wife"}
            </label>
          ))}
        </div>
      </fieldset>
      <FieldProblem field="role" problems={problems} />

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
        onChange={(event) => onChange("nin", event.target.value)}
        aria-invalid={problems.nin !== undefined}
        aria-describedby={describedBy("nin", problems)}
        className={styles.input}
      />
      <FieldProblem field="nin" problems={problems} />

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
        onChange={(event) => onChange("bvn", event.target.value)}
        aria-invalid={problems.bvn !== undefined}
        aria-describedby={describedBy("bvn", problems)}
        className={styles.input}
      />
      <FieldProblem field="bvn" problems={problems} />
    </>
  );
}

/** The test-terms box, with its approved wording. */
export function TermsField({
  ticked,
  onChange,
  problems,
}: {
  ticked: boolean;
  onChange: (ticked: boolean) => void;
  problems: Problems;
}) {
  return (
    <>
      <label className={styles.terms}>
        <input
          type="checkbox"
          name="terms"
          checked={ticked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={describedBy("testTermsAccepted", problems)}
          className={styles.termsBox}
        />
        <span>I understand this is a test environment: no real money moves, and the identity check is simulated.</span>
      </label>
      <FieldProblem field="testTermsAccepted" problems={problems} />
    </>
  );
}
