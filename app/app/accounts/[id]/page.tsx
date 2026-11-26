// The statement screen, at /app/accounts/<id>.
//
// It shows one account (the wallet or a pot) with its current balance,
// and the entries behind that balance, newest first. It is read only:
// nothing on this screen can move money.
//
// This is a server page. The server reads the statement, builds the
// finished page, and sends only the result to the visitor's phone.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getAccountStatement, STATEMENT_LINE_LIMIT, type AccountStatement } from "../../../../lib/ledger";
import { formatNaira } from "../../../../lib/money";
import { requireSession } from "../../../../lib/session";
import { balancesAgree, describeAmount, formatStatementDate } from "../../../../lib/statement";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function AccountStatementPage({ params }: { params: Promise<{ id: string }> }) {
  // Wait for a real visit, so the page is built fresh each time and never
  // shows an old copy of the statement.
  await connection();

  // The signed-in person, before anything is read. With no session, this
  // sends the visitor to /sign-in and nothing is read from the database.
  // The household is always this person's own, from their session.
  const person = await requireSession();

  // In this version of Next.js the address parts arrive as a promise.
  // The id is only ever handed to getAccountStatement, which checks it.
  const { id } = await params;

  let statement: AccountStatement | null = null;
  let failed = false;

  try {
    statement = await getAccountStatement(person.householdId, id);
  } catch {
    // Whatever went wrong, the visitor sees only the calm sentence below.
    // The reason is written to the server's log by the ledger reader.
    failed = true;
  }

  if (failed) {
    return (
      <div className={styles.screen}>
        <a href="/app" className={styles.back}>
          ‹ Back to balances
        </a>
        <p className={styles.notice} role="status">
          We could not load this statement right now. Please try again.
        </p>
      </div>
    );
  }

  // An id that is badly formed, unknown, from another household, or the
  // bank account: all get the standard "not found" page, with no reason.
  // notFound() stops the page here, so it is outside the try block above.
  if (statement === null) {
    notFound();
  }

  const { account, lines } = statement;
  const showBalanceAfter = balancesAgree(account.balance_kobo, lines);

  return (
    <div className={styles.screen}>
      <a href="/app" className={styles.back}>
        ‹ Back to balances
      </a>

      <h1 className={styles.name}>{account.name}</h1>
      <p className={styles.balanceLabel}>Balance</p>
      <p className={styles.balance}>{formatNaira(account.balance_kobo)}</p>

      {lines.length === 0 ? (
        <p className={styles.notice}>No entries yet.</p>
      ) : (
        <ul className={styles.lines}>
          {lines.map((line, position) => {
            const amount = describeAmount(line.amount_kobo, formatNaira);
            return (
              // Lines have no id of their own, so their place in the list
              // tells them apart. The list never changes once drawn.
              <li key={position} className={styles.line}>
                <div className={styles.row}>
                  <p className={styles.description}>{line.description}</p>
                  <p className={styles.amount}>{amount.text}</p>
                </div>
                <div className={styles.row}>
                  <time className={styles.date} dateTime={line.created_at}>
                    {formatStatementDate(line.created_at)}
                  </time>
                  <p className={amount.direction === "In" ? styles.directionIn : styles.directionOut}>
                    {amount.direction}
                  </p>
                </div>
                {showBalanceAfter ? (
                  <p className={styles.after}>Balance after: {formatNaira(line.balance_after_kobo)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {lines.length === STATEMENT_LINE_LIMIT ? (
        <p className={styles.note}>Showing the latest {STATEMENT_LINE_LIMIT} lines.</p>
      ) : null}
    </div>
  );
}
