// The profile screen, at /app/profile.
//
// It shows the signed-in person's own details, their identity check, their
// access code, their household's wallet and pots with test account
// numbers, and the "Sign out" button.
//
// The person always comes from this browser's session, here on the
// server. Nothing in the address or any form can choose whose profile is
// shown, and nothing from the profile is ever put in an address.
//
// It is built fresh for every visit and never stored.

import type { Metadata } from "next";
import { connection } from "next/server";

import { formatAccessCode, tidyAccessCode } from "../../../lib/access-code";
import { getProfile } from "../../../lib/auth-db";
import { profileDisplay } from "../../../lib/profile-core";
import { getMyAccessCode, requireSession } from "../../../lib/session";
import { AccessCode } from "../../welcome/access-code";
import styles from "./page.module.css";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "FamilyFi",
};

// The one sentence shown when something on this page cannot be read. It
// reads correctly for an owner and a partner alike.
const LOAD_FAILED_SENTENCE = "We could not load this right now. Please try again.";

export default async function ProfilePage() {
  // Wait for a real visit, so this page is never served from a stored copy.
  await connection();

  // No session: a redirect to /sign-in. It works by stopping the page, so
  // it is never inside a try block.
  const person = await requireSession();

  const [profile, code] = await Promise.all([getProfile(person.customerId), getMyAccessCode()]);

  const backLink = (
    <a href="/app" className={styles.back}>
      ‹ Back to my household
    </a>
  );

  if (profile === null) {
    return (
      <div className={styles.screen}>
        {backLink}
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.notice} role="status">
          {LOAD_FAILED_SENTENCE}
        </p>
        <SignOutButton />
      </div>
    );
  }

  const shown = profileDisplay(profile);

  return (
    <div className={styles.screen}>
      {backLink}
      <h1 className={styles.title}>Profile</h1>

      <section className={styles.section} aria-labelledby="your-details">
        <h2 id="your-details" className={styles.heading}>
          Your details
        </h2>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt>Full name</dt>
            <dd>{shown.fullName}</dd>
          </div>
          <div className={styles.row}>
            <dt>Role</dt>
            <dd>{shown.role}</dd>
          </div>
          <div className={styles.row}>
            <dt>Phone</dt>
            <dd className={styles.number}>{shown.phone}</dd>
          </div>
          <div className={styles.row}>
            <dt>Household</dt>
            <dd>{shown.householdName}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="identity">
        <h2 id="identity" className={styles.heading}>
          Identity
        </h2>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt>NIN</dt>
            <dd className={styles.number}>{shown.ninMasked}</dd>
          </div>
          <div className={styles.row}>
            <dt>BVN</dt>
            <dd className={styles.number}>{shown.bvnMasked}</dd>
          </div>
        </dl>
        <p className={styles.verified}>Identity: verified (simulated)</p>
        {shown.verifiedOn !== null ? <p className={styles.date}>{shown.verifiedOn}</p> : null}
      </section>

      <section className={styles.section} aria-labelledby="access-code">
        <h2 id="access-code" className={styles.heading}>
          Access code
        </h2>
        {code === null ? (
          <p className={styles.notice} role="status">
            {LOAD_FAILED_SENTENCE}
          </p>
        ) : (
          <AccessCode code={formatAccessCode(tidyAccessCode(code))} />
        )}
      </section>

      <section className={styles.section} aria-labelledby="accounts">
        <h2 id="accounts" className={styles.heading}>
          Accounts
        </h2>
        <ul className={styles.accounts}>
          {shown.accounts.map((account) => (
            <li key={account.name} className={styles.account}>
              <p className={styles.accountName}>{account.name}</p>
              {account.accountNumber !== null ? (
                <p className={styles.accountNumber}>
                  <span className={styles.accountLabel}>Test account number</span>
                  <span className={styles.number}>{account.accountNumber}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <SignOutButton />
    </div>
  );
}
