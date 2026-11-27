// The household screen, at /app/household.
//
// It shows who is in the household, and, for the owner while there is no
// partner, the invite section: the button to create an invite code, or the
// unused code with when it stops working.
//
// The person always comes from this browser's session, here on the
// server. Nothing in the address or any form can choose a person or a
// household: the address can only carry an error code from a fixed list.
// It is built fresh for every visit and never stored.

import type { Metadata } from "next";
import { connection } from "next/server";

import { readMyHouseholdMembers, readMyInvite } from "../../../lib/household";
import type { ReadInviteOutcome } from "../../../lib/household-core";
import { householdErrorSentence, householdView, readHouseholdError } from "../../../lib/household-screen";
import { INVITE_TRY_AGAIN_SENTENCE } from "../../../lib/invite-rules";
import { requireSession } from "../../../lib/session";
import { createInviteAction } from "./actions";
import styles from "./page.module.css";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "FamilyFi",
};

export default async function HouseholdPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Wait for a real visit, so this page is never served from a stored copy.
  await connection();

  // The signed-in person, before anything is read. With no session, this
  // sends the visitor to /sign-in and nothing is read from the database.
  await requireSession();

  // An error code from the address, such as ?error=not_owner. Only a code
  // on the fixed list is shown, as its fixed sentence.
  const errorCode = readHouseholdError((await searchParams).error);

  const backLink = (
    <a href="/app" className={styles.back}>
      ‹ Back to my household
    </a>
  );

  const members = await readMyHouseholdMembers();
  const view = members.status === "members" ? householdView(members.members) : null;

  if (members.status !== "members" || view === null) {
    return (
      <div className={styles.screen}>
        {backLink}
        <h1 className={styles.title}>Household</h1>
        <p className={styles.notice} role="status">
          {INVITE_TRY_AGAIN_SENTENCE}
        </p>
      </div>
    );
  }

  // The invite is read only for the owner, and only while there is no
  // partner. A partner's page never asks for it.
  let invite: ReadInviteOutcome | null = null;
  if (view === "owner_alone") {
    invite = await readMyInvite();
  }

  return (
    <div className={styles.screen}>
      {backLink}
      <h1 className={styles.title}>Household</h1>

      <section className={styles.section} aria-labelledby="members">
        <h2 id="members" className={styles.heading}>
          Members
        </h2>
        <ul className={styles.members}>
          {members.members.map((member) => (
            <li key={`${member.memberRole}-${member.fullName}`} className={styles.member}>
              <span className={styles.memberName}>
                {member.fullName}
                {member.isYou ? <span className={styles.you}> (you)</span> : null}
              </span>
              <span className={styles.memberRole}>{member.memberRole === "owner" ? "Owner" : "Partner"}</span>
            </li>
          ))}
        </ul>
      </section>

      {errorCode !== null ? (
        <p className={styles.error} role="alert">
          {householdErrorSentence(errorCode)}
        </p>
      ) : null}

      {view === "owner_full" ? <p className={styles.notice}>Your partner has joined. Your household is full.</p> : null}

      {view === "partner" ? <p className={styles.notice}>Only the person who created the household can invite a partner.</p> : null}

      {view === "owner_alone" && invite !== null ? (
        <section className={styles.section} aria-labelledby="invite">
          <h2 id="invite" className={styles.heading}>
            Invite your partner
          </h2>

          {invite.status === "active" ? (
            <>
              <div className={styles.codeCard}>
                <p className={styles.code}>{invite.code}</p>
              </div>
              <p className={styles.note}>Send this code to your partner. It works once, for 48 hours.</p>
              <p className={styles.stops}>{invite.stopsWorking}</p>
              <p className={styles.note}>A new code stops the old one working.</p>
              <form action={createInviteAction} className={styles.form}>
                <SubmitButton className={styles.button} label="Create a new code" />
              </form>
            </>
          ) : (
            <>
              {invite.status === "failed" ? (
                <p className={styles.notice} role="status">
                  {invite.message}
                </p>
              ) : null}
              <form action={createInviteAction} className={styles.form}>
                <SubmitButton className={styles.button} label="Create an invite code" />
              </form>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
