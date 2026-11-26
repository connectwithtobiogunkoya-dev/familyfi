"use server";

// The server action behind the Add money form.
//
// "use server" means this runs only on the server. The browser can ask
// for it to run, by submitting the form, but never sees or runs the code.
// Anyone could also send that request by hand, so this action trusts
// nothing: it passes the two form fields straight to addMoney, which does
// every check (kill switch, key, amount, accounts, ceiling).

import { redirect } from "next/navigation";

import { getCurrentHouseholdId } from "../../../lib/current-household";
import { addMoney } from "../../../lib/moves";
import { pathAfterAddMoney } from "../../../lib/redirects";

export async function addMoneyAction(formData: FormData): Promise<void> {
  // Whatever the browser sent, as it sent it. addMoney refuses anything
  // that is missing or not in the right form.
  // The household comes from the server, never from the form.
  const result = await addMoney(getCurrentHouseholdId(), {
    amount: formData.get("amount"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  // addMoney never throws, so there is no try block here. redirect works
  // by stopping the action, which is why it must never sit inside one.
  redirect(pathAfterAddMoney(result));
}
