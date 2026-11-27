// The Add money and Move money server actions: the order of checks, in a
// file tests can load.
//
// app/app/add-money/actions.ts and app/app/move-money/actions.ts are the
// real actions. They plug in the real switch, the real session and the
// real write path, and then send the browser to the address this gives.
//
// The order, for both:
//   1. The write switch, first. It needs no database. When money movement
//      is paused, the answer is the paused outcome, even with no session.
//   2. The session. With no session, the answer is /sign-in, and nothing
//      else happens: no database call and no money call.
//   3. Every existing check, in lib/moves-core.ts, for the signed-in
//      person's own household. The household is session.householdId and
//      the person making it is session.customerId, never anything from
//      the form: only the named fields are read.

import type { AddMoneyInput, MoveMoneyInput, MoveResult } from "./moves-core.ts";
import { pathAfterAddMoney, pathAfterMoveMoney } from "./redirects.ts";
import type { SessionPerson } from "./session-core.ts";

/** Anything with a get(name), such as FormData. */
export type FormSource = { get: (name: string) => unknown };

export type MoneyActionDeps = {
  writesEnabled: () => boolean;
  getSession: () => Promise<SessionPerson | null>;
};

export type AddMoneyActionDeps = MoneyActionDeps & {
  addMoney: (householdId: string, createdBy: string, input: AddMoneyInput) => Promise<MoveResult>;
};

export type MoveMoneyActionDeps = MoneyActionDeps & {
  moveMoney: (householdId: string, createdBy: string, input: MoveMoneyInput) => Promise<MoveResult>;
};

const PAUSED: MoveResult = { status: "refused", code: "writes_off" };
const UNKNOWN: MoveResult = { status: "refused", code: "unknown" };

/** The signed-in person, or null. A failure counts as not signed in. */
async function sessionOrNull(deps: MoneyActionDeps): Promise<SessionPerson | null> {
  try {
    return await deps.getSession();
  } catch {
    return null;
  }
}

/** Gives the address to send the browser to after an Add money request. */
export async function runAddMoneyAction(form: FormSource, deps: AddMoneyActionDeps): Promise<string> {
  // 1. The write switch.
  if (!deps.writesEnabled()) {
    return pathAfterAddMoney(PAUSED);
  }

  // 2. The session.
  const person = await sessionOrNull(deps);
  if (person === null) {
    return "/sign-in";
  }

  // 3. The existing checks, for this person's household only.
  try {
    const result = await deps.addMoney(person.householdId, person.customerId, {
      amount: form.get("amount"),
      idempotencyKey: form.get("idempotencyKey"),
    });
    return pathAfterAddMoney(result);
  } catch {
    return pathAfterAddMoney(UNKNOWN);
  }
}

/** Gives the address to send the browser to after a Move money request. */
export async function runMoveMoneyAction(form: FormSource, deps: MoveMoneyActionDeps): Promise<string> {
  // 1. The write switch.
  if (!deps.writesEnabled()) {
    return pathAfterMoveMoney(PAUSED);
  }

  // 2. The session.
  const person = await sessionOrNull(deps);
  if (person === null) {
    return "/sign-in";
  }

  // 3. The existing checks, for this person's household only.
  try {
    const result = await deps.moveMoney(person.householdId, person.customerId, {
      amount: form.get("amount"),
      fromAccountId: form.get("fromAccountId"),
      toAccountId: form.get("toAccountId"),
      idempotencyKey: form.get("idempotencyKey"),
    });
    return pathAfterMoveMoney(result);
  } catch {
    return pathAfterMoveMoney(UNKNOWN);
  }
}
