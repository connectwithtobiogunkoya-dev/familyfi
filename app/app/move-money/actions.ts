"use server";

// The server action behind the Move money form.
//
// "use server" means this runs only on the server. The browser can ask
// for it to run, by submitting the form, but never sees or runs the code.
// Anyone could also send that request by hand, so this action trusts
// nothing: it passes the four form fields straight to moveMoney, which
// does every check (kill switch, key, amount, accounts, the wallet-and-pot
// rule).

import { redirect } from "next/navigation";

import { moveMoney } from "../../../lib/moves";
import { pathAfterMoveMoney } from "../../../lib/redirects";

export async function moveMoneyAction(formData: FormData): Promise<void> {
  // Whatever the browser sent, as it sent it. moveMoney refuses anything
  // that is missing or not in the right form.
  const result = await moveMoney({
    amount: formData.get("amount"),
    fromAccountId: formData.get("fromAccountId"),
    toAccountId: formData.get("toAccountId"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  // moveMoney never throws, so there is no try block here. redirect works
  // by stopping the action, which is why it must never sit inside one.
  redirect(pathAfterMoveMoney(result));
}
