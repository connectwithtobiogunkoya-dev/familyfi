"use server";

// The server action behind "Create an invite code" and "Create a new code".
//
// "use server" means this runs only on the server. The form sends no
// fields at all: the person comes from their session, and the database
// finds their household from that person. Next.js's own checks for server
// actions stay exactly as they are.
//
// The order: the session first, before anything else; then the sign-up
// switch, the key and the database call (lib/household-core.ts). The
// database alone decides who is the owner, so a partner is refused there
// whatever the screen shows.
//
// Afterwards the browser goes back to /app/household, where the new code
// is read again and shown inside a page built on the server. The code is
// never put in an address, a cookie, a returned value, a log or an error.

import { redirect } from "next/navigation";

import { createInvite } from "../../../lib/auth-db";
import { runCreateInviteAction } from "../../../lib/household-screen";
import { generateInviteCode } from "../../../lib/invite-code";
import { getAccessCodeKeys } from "../../../lib/secrets";
import { getSession } from "../../../lib/session";
import { signupsEnabled } from "../../../lib/settings";

export async function createInviteAction(): Promise<void> {
  // 1. The session, before anything else. With none: /sign-in, and no
  //    database call.
  const person = await getSession();
  if (person === null) {
    redirect("/sign-in");
  }

  // 2. The sign-up switch, the key and the call. runCreateInviteAction
  //    never throws, so there is no try block here.
  const path = await runCreateInviteAction({
    getSession: async () => person,
    signupsEnabled: () => signupsEnabled(),
    accessCodeKeys: getAccessCodeKeys,
    createInvite,
    generateInviteCode: () => generateInviteCode(),
  });

  // redirect works by stopping the action, which is why it must never sit
  // inside a try block.
  redirect(path);
}
