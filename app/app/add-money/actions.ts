"use server";

// The server action behind the Add money form.
//
// "use server" means this runs only on the server. The browser can ask
// for it to run, by submitting the form, but never sees or runs the code.
// Anyone could also send that request by hand, so this action trusts
// nothing. The order of checks is in lib/money-actions-core.ts: the write
// switch first, then the session, then every check in addMoney. The
// household is the signed-in person's own, from their session, never from
// the form.

import { redirect } from "next/navigation";

import { runAddMoneyAction } from "../../../lib/money-actions-core";
import { addMoney } from "../../../lib/moves";
import { getSession } from "../../../lib/session";
import { writesEnabled } from "../../../lib/settings";

export async function addMoneyAction(formData: FormData): Promise<void> {
  const path = await runAddMoneyAction(formData, {
    writesEnabled: () => writesEnabled(),
    getSession,
    addMoney,
  });

  // runAddMoneyAction never throws, so there is no try block here.
  // redirect works by stopping the action, which is why it must never sit
  // inside one.
  redirect(path);
}
