// Turning a checked profile (from getProfileCall in lib/auth-db-core.ts)
// into the words and numbers the profile screen shows.
//
//   * The NIN and BVN: bullets, then the last 3 digits, for example
//     ••••••••123. The full numbers never reach the app at all.
//   * The date the identity check passed: a date in Lagos, for example
//     26 November 2026.
//   * The role: "Husband" or "Wife".
//   * The kind of each account: "Wallet" or "Pot".

import type { ProfileAnswer } from "./auth-db-core.ts";

/** The 8 bullets shown in place of the first 8 digits of a NIN or BVN. */
const HIDDEN_PART = "•".repeat(8);

/**
 * A NIN or BVN with all but its last 3 digits hidden: "123" gives
 * "••••••••123". Anything that is not exactly 3 digits gives 11 bullets,
 * so nothing unexpected is ever shown.
 */
export function maskedNumber(last3: unknown): string {
  if (typeof last3 !== "string" || !/^[0-9]{3}$/.test(last3)) {
    return "•".repeat(11);
  }
  return HIDDEN_PART + last3;
}

/** A moment as a date in Lagos, for example "26 November 2026". Null if it is not a date. */
export function lagosDisplayDate(moment: string): string | null {
  const time = Date.parse(moment);
  if (Number.isNaN(time)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(time));
}

export function roleLabel(role: "husband" | "wife"): string {
  return role === "husband" ? "Husband" : "Wife";
}

export function accountKindLabel(kind: "wallet" | "pot"): string {
  return kind === "wallet" ? "Wallet" : "Pot";
}

export type ProfileDisplay = {
  fullName: string;
  role: string;
  phone: string;
  householdName: string;
  ninMasked: string;
  bvnMasked: string;
  verifiedOn: string | null;
  accounts: Array<{ name: string; kindLabel: string; accountNumber: string | null }>;
};

export function profileDisplay(profile: ProfileAnswer): ProfileDisplay {
  return {
    fullName: profile.fullName,
    role: roleLabel(profile.role),
    phone: profile.phone,
    householdName: profile.householdName,
    ninMasked: maskedNumber(profile.ninLast3),
    bvnMasked: maskedNumber(profile.bvnLast3),
    verifiedOn: lagosDisplayDate(profile.verifiedAt),
    accounts: profile.accounts.map((account) => ({
      name: account.name,
      kindLabel: accountKindLabel(account.kind),
      accountNumber: account.accountNumber,
    })),
  };
}
