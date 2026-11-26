"use server";

// The server action behind the Move money form.
//
// "use server" means this runs only on the server. The browser can ask
// for it to run, by submitting the form, but never sees or runs the code.
// Anyone could also send that request by hand, so this action trusts
// nothing. The order of checks is in lib/money-actions-core.ts: the write
// switch first, then the session, then every check in moveMoney (key,
// amount, accounts, the wallet-and-pot rule). The household is the
// signed-in person's own, from their session, never from the form.

import { redirect } from "next/navigation";

import { runMoveMoneyAction } from "../../../lib/money-actions-core";
import { moveMoney } from "../../../lib/moves";
import { getSession } from "../../../lib/session";
import { writesEnabled } from "../../../lib/settings";

export async function moveMoneyAction(formData: FormData): Promise<void> {
  const path = await runMoveMoneyAction(formData, {
    writesEnabled: () => writesEnabled(),
    getSession,
    moveMoney,
  });

  // runMoveMoneyAction never throws, so there is no try block here.
  // redirect works by stopping the action, which is why it must never sit
  // inside one.
  redirect(path);
}
