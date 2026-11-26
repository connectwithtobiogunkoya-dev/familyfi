// The Move money screen, at /app/move-money.
//
// It shows the wallet and the pots with their balances, and a form to move
// money from the wallet to a pot or from a pot back to the wallet. The
// form only sends the two chosen accounts, what the visitor typed and a
// one-time key; the server checks all of it.

import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { connection } from "next/server";

import { errorSentence, readErrorCode } from "../../../lib/errors";
import { getHouseholdBalances, type AccountBalance } from "../../../lib/ledger";
import { formatNaira } from "../../../lib/money";
import { requireSession } from "../../../lib/session";
import { writesEnabled } from "../../../lib/settings";
import { moveMoneyAction } from "./actions";
import styles from "./page.module.css";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function MoveMoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Wait for a real visit, so the page (and its one-time key) is built
  // fresh every time and never served from a stored copy.
  await connection();

  // The signed-in person, before anything is read. With no session, this
  // sends the visitor to /sign-in and nothing is read from the database.
  // The household is always this person's own, from their session.
  const person = await requireSession();

  const backLink = (
    <a href="/app" className={styles.back}>
      ‹ Back to balances
    </a>
  );

  // The kill switch. When money movement is paused, there is no form at
  // all, and the database is not even asked for the balances.
  if (!writesEnabled()) {
    return (
      <div className={styles.screen}>
        {backLink}
        <h1 className={styles.title}>Move money</h1>
        <p className={styles.notice} role="status">
          {errorSentence("writes_off")}
        </p>
      </div>
    );
  }

  // An error code from the address, such as ?error=bad_accounts. Only a
  // code on the fixed list is shown, as its fixed sentence.
  const errorCode = readErrorCode((await searchParams).error);

  // The wallet and the pots, from the database. getHouseholdBalances never
  // returns the bank account, so it cannot appear anywhere on this screen.
  let accounts: AccountBalance[] = [];
  try {
    accounts = await getHouseholdBalances(person.householdId);
  } catch {
    // The reason is written to the server log by the ledger reader.
    accounts = [];
  }

  const wallet = accounts.find((account) => account.kind === "wallet");
  const pots = accounts.filter((account) => account.kind === "pot");

  if (wallet === undefined || pots.length === 0) {
    return (
      <div className={styles.screen}>
        {backLink}
        <h1 className={styles.title}>Move money</h1>
        <p className={styles.notice} role="status">
          We could not load your accounts right now. Please try again.
        </p>
      </div>
    );
  }

  // The choices for "From" and "To": the wallet first, then the pots, in
  // the same order as on /app. Each value is the account's id from the
  // database.
  const choices = [wallet, ...pots];

  // A new random key every time the screen is built. If the same form is
  // sent twice (a double tap, a resend), the key is the same, and the
  // database moves the money only once.
  const idempotencyKey = randomUUID();

  return (
    <div className={styles.screen}>
      {backLink}
      <h1 className={styles.title}>Move money</h1>

      <ul className={styles.balances} aria-label="Balances">
        {choices.map((account) => (
          <li key={account.account_id} className={account.kind === "wallet" ? styles.walletRow : styles.potRow}>
            <span className={styles.rowName}>{account.name}</span>
            <span className={styles.rowAmount}>{formatNaira(account.balance_kobo)}</span>
          </li>
        ))}
      </ul>

      {errorCode !== null ? (
        <p className={styles.error} role="alert">
          {errorSentence(errorCode)}
        </p>
      ) : null}

      <form action={moveMoneyAction} className={styles.form}>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <label htmlFor="fromAccountId" className={styles.label}>
          From
        </label>
        <select id="fromAccountId" name="fromAccountId" defaultValue={wallet.account_id} required className={styles.select}>
          {choices.map((account) => (
            <AccountOption key={account.account_id} account={account} />
          ))}
        </select>

        <label htmlFor="toAccountId" className={styles.label}>
          To
        </label>
        <select id="toAccountId" name="toAccountId" defaultValue={pots[0].account_id} required className={styles.select}>
          {choices.map((account) => (
            <AccountOption key={account.account_id} account={account} />
          ))}
        </select>

        <label htmlFor="amount" className={styles.label}>
          Amount (₦)
        </label>
        <input
          id="amount"
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          aria-describedby="amount-hint"
          className={styles.input}
        />
        <p id="amount-hint" className={styles.hint}>
          Up to ₦1,000,000 at a time
        </p>

        <SubmitButton className={styles.button} />
      </form>
    </div>
  );
}

// One choice in a "From" or "To" list: the account's name, with its id
// from the database as the value that is sent.
function AccountOption({ account }: { account: AccountBalance }) {
  return <option value={account.account_id}>{account.name}</option>;
}
