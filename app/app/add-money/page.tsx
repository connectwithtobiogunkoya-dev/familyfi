// The Add money screen, at /app/add-money.
//
// It shows the wallet's balance and a form to add money to it from the
// household's bank account. The form only sends what the visitor typed
// and a one-time key; the server decides everything else.

import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { connection } from "next/server";

import { errorSentence, readErrorCode } from "../../../lib/errors";
import { getHouseholdBalances } from "../../../lib/ledger";
import { formatNaira } from "../../../lib/money";
import { writesEnabled } from "../../../lib/settings";
import { addMoneyAction } from "./actions";
import styles from "./page.module.css";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function AddMoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Wait for a real visit, so the page (and its one-time key) is built
  // fresh every time and never served from a stored copy.
  await connection();

  const backLink = (
    <a href="/app" className={styles.back}>
      ‹ Back to balances
    </a>
  );

  // The kill switch. When money movement is paused, there is no form at
  // all, and the database is not even asked for the balance.
  if (!writesEnabled()) {
    return (
      <div className={styles.screen}>
        {backLink}
        <h1 className={styles.title}>Add money</h1>
        <p className={styles.notice} role="status">
          {errorSentence("writes_off")}
        </p>
      </div>
    );
  }

  // An error code from the address, such as ?error=not_enough. Only a
  // code on the fixed list is shown, as its fixed sentence.
  const errorCode = readErrorCode((await searchParams).error);

  // The wallet, read from the database: its name and its balance.
  let wallet: { name: string; balance: string } | null = null;
  try {
    const account = (await getHouseholdBalances()).find((a) => a.kind === "wallet");
    wallet = account === undefined ? null : { name: account.name, balance: formatNaira(account.balance_kobo) };
  } catch {
    // The reason is written to the server log by the ledger reader.
    wallet = null;
  }

  if (wallet === null) {
    return (
      <div className={styles.screen}>
        {backLink}
        <h1 className={styles.title}>Add money</h1>
        <p className={styles.notice} role="status">
          We could not load your wallet right now. Please try again.
        </p>
      </div>
    );
  }

  // A new random key every time the screen is built. If the same form is
  // sent twice (a double tap, a resend), the key is the same, and the
  // database moves the money only once.
  const idempotencyKey = randomUUID();

  return (
    <div className={styles.screen}>
      {backLink}
      <h1 className={styles.title}>Add money</h1>

      <section className={styles.wallet} aria-label={wallet.name}>
        <p className={styles.walletLabel}>{wallet.name}</p>
        <p className={styles.walletAmount}>{wallet.balance}</p>
      </section>

      {errorCode !== null ? (
        <p className={styles.error} role="alert">
          {errorSentence(errorCode)}
        </p>
      ) : null}

      <form action={addMoneyAction} className={styles.form}>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

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
