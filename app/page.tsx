// The front page, at /.
//
// It is static: built once, the same for everyone, and it never reads the
// session or the database. It says what FamilyFi is in one line and
// offers the two ways in.

import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>FamilyFi</h1>
      <p className={styles.line}>This is a test environment: no real money moves.</p>
      <div className={styles.buttons}>
        <a href="/sign-up" className={styles.primary}>
          Create your household
        </a>
        <a href="/sign-in" className={styles.secondary}>
          Sign in
        </a>
      </div>
    </div>
  );
}
