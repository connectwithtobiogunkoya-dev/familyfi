// The sign-out button's server action: the rules, in a file tests can
// load.
//
// app/sign-out/actions.ts is the real action. It plugs in the real
// endCurrentSession (lib/sign-out.ts, which uses lib/sign-out-core.ts),
// deletes the cookie, and sends the browser to /.
//
// The caller is ALWAYS told to delete the cookie, even when ending the
// session in the database failed: a browser that asked to sign out is
// never left signed in.

import type { SignOutResult } from "./sign-out-core.ts";

export type SignOutActionOutcome = { deleteCookie: true; redirectTo: "/" };

export type SignOutActionDeps = {
  endCurrentSession: () => Promise<SignOutResult>;
};

export async function runSignOutAction(deps: SignOutActionDeps): Promise<SignOutActionOutcome> {
  try {
    await deps.endCurrentSession();
  } catch {
    // Nothing to do: the cookie goes regardless.
  }
  return { deleteCookie: true, redirectTo: "/" };
}
