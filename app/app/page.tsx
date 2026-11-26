// The home screen of the app, at the address /app.
//
// It shows the household's wallet and pots with their balances, a
// confirmation line after money has moved, and the way to Add money.
// Nothing on this screen moves money by itself.
//
// This is a server page. The server reads the balances, builds the
// finished page, and sends only the result to the visitor's phone. No
// code from this file runs in the browser.

import type { Metadata } from "next";
import { connection } from "next/server";

import { errorSentence } from "../../lib/errors";
import { getCurrentHouseholdId } from "../../lib/current-household";
import { getHouseholdBalances } from "../../lib/ledger";
import { formatNaira } from "../../lib/money";
import { readNotice } from "../../lib/notices";
import { writesEnabled } from "../../lib/settings";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FamilyFi",
};

// What the screen needs for one card: a name and ready-to-read money text.
type Card = {
  id: string;
  name: string;
  amount: string;
};

// The address of an account's statement. The id comes from the database,
// and is encoded anyway so it can never change the shape of the address.
function statementAddress(accountId: string): string {
  return `/app/accounts/${encodeURIComponent(accountId)}`;
}

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Wait for a real visit before doing anything. Without this line, the
  // page would be built once when the site is deployed and would show
  // the same old balances to everyone afterwards.
  await connection();

  // A confirmation from the address, such as ?notice=added. Only the exact
  // codes "added" and "replayed" are accepted, each as a fixed sentence.
  const notice = readNotice((await searchParams).notice);
  const canMoveMoney = writesEnabled();

  let wallet: Card | null = null;
  let pots: Card[] = [];

  try {
    const balances = await getHouseholdBalances(getCurrentHouseholdId());

    for (const account of balances) {
      const card: Card = {
        id: account.account_id,
        name: account.name,
        amount: formatNaira(account.balance_kobo),
      };

      if (account.kind === "wallet") {
        wallet = card;
      } else {
        pots.push(card);
      }
    }
  } catch {
    // Whatever went wrong, the visitor sees only the calm message below.
    // The reason is written to the server's log by the ledger reader.
    wallet = null;
    pots = [];
  }

  return (
    <div className={styles.screen}>
      {notice !== null ? (
        <p className={styles.confirmation} role="status">
          {notice}
        </p>
      ) : null}

      <h1 className={styles.family}>The Adeyemi Family</h1>

      {wallet === null ? (
        <p className={styles.notice} role="status">
          We could not load the balances right now. Please try again in a moment.
        </p>
      ) : (
        <>
          {/* Each card is a link to that account's statement. */}
          <a href={statementAddress(wallet.id)} className={styles.wallet}>
            <p className={styles.walletLabel}>{wallet.name}</p>
            <p className={styles.walletAmount}>{wallet.amount}</p>
            {/* A visual cue that the card opens a statement. Screen readers
                skip it, and read the link by its name and amount. */}
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </a>

          {/* The ways to Add money and Move money. When money movement is
              paused, both buttons are replaced by the fixed paused
              sentence. */}
          {canMoveMoney ? (
            <div className={styles.actions}>
              <a href="/app/add-money" className={styles.action}>
                Add money
              </a>
              <a href="/app/move-money" className={styles.action}>
                Move money
              </a>
            </div>
          ) : (
            <p className={styles.paused}>{errorSentence("writes_off")}</p>
          )}

          <ul className={styles.pots}>
            {pots.map((pot) => (
              <li key={pot.id}>
                <a href={statementAddress(pot.id)} className={styles.pot}>
                  <p className={styles.potLabel}>{pot.name}</p>
                  <p className={styles.potAmount}>{pot.amount}</p>
                  <span className={styles.chevron} aria-hidden="true">
                    ›
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
