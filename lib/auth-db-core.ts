// The database calls for signing up, signing in and sessions.
//
// One thin function for each database function in the Slice 5 migrations:
//   createHouseholdCall       create_household (18 arguments)
//   signInWithCodeCall        sign_in_with_code
//   getSessionRowCall         get_session
//   endSessionRowCall         end_session
//   getAccessCodeMaterialCall get_access_code_material
//
// Each one is given an "rpc" function that calls the database. The real
// one is in lib/auth-db.ts (server only); tests hand it a stand-in. Every
// answer is checked by hand before it is trusted: anything not in the
// expected shape, and any failure with no database answer, becomes the
// code "unknown". Nothing here is logged.

import { readSignInStatus, readSignUpRefusal, type SignInStatus, type SignUpRefusalCode } from "./auth-limits.ts";
import { normaliseAccountId } from "./statement.ts";

/** What one database call gives back: data, or an error. */
export type RpcAnswer = { data: unknown; error: { message?: unknown } | null; status?: number };

/** Calls one database function by name with its arguments. */
export type Rpc = (functionName: string, args: Record<string, unknown>) => Promise<RpcAnswer>;

const HEX_64 = /^[0-9a-f]{64}$/;

function isUuid(value: unknown): value is string {
  return normaliseAccountId(value) !== null;
}

// A call that throws, or comes back with status 0 (no answer from the
// network), is a failure with no database answer.
async function call(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<RpcAnswer | null> {
  try {
    const answer = await rpc(name, args);
    if (answer === null || typeof answer !== "object") {
      return null;
    }
    return answer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// create_household
// ---------------------------------------------------------------------

/** Everything create_household needs, already checked and made on the server. */
export type CreateHouseholdArgs = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  role: "husband" | "wife";
  nin: string;
  bvn: string;
  householdName: string;
  testTermsAccepted: boolean;
  codeHash: string;
  codeEncrypted: string;
  keyVersion: number;
  visitorHash: string;
  maxSignUpsPerVisitor: number;
  maxCustomersPerDay: number;
  maxCustomersTotal: number;
  tokenHash: string;
  idleDays: number;
  absoluteDays: number;
};

export type CreateHouseholdResult =
  | { ok: true; customerId: string; householdId: string; sessionId: string }
  | { ok: false; code: SignUpRefusalCode | "unknown" };

/**
 * Call create_household once, with its 18 arguments in the order the
 * migration defines them.
 *
 * There is deliberately NO automatic retry. If an answer were lost after
 * the database had saved the household, a second try would make a second
 * household, or be refused, and either way the person would never be
 * shown the access code of the household that was made. A lost answer is
 * reported as "unknown" instead, and the person can try again knowingly.
 */
export async function createHouseholdCall(args: CreateHouseholdArgs, rpc: Rpc): Promise<CreateHouseholdResult> {
  const answer = await call(rpc, "create_household", {
    p_full_name: args.fullName,
    p_phone: args.phone,
    p_date_of_birth: args.dateOfBirth,
    p_role: args.role,
    p_nin: args.nin,
    p_bvn: args.bvn,
    p_household_name: args.householdName,
    p_test_terms_accepted: args.testTermsAccepted,
    p_code_hash: args.codeHash,
    p_code_encrypted: args.codeEncrypted,
    p_key_version: args.keyVersion,
    p_visitor_hash: args.visitorHash,
    p_max_signups_per_visitor: args.maxSignUpsPerVisitor,
    p_max_customers_per_day: args.maxCustomersPerDay,
    p_max_customers_total: args.maxCustomersTotal,
    p_token_hash: args.tokenHash,
    p_idle_days: args.idleDays,
    p_absolute_days: args.absoluteDays,
  });

  if (answer === null || answer.status === 0) {
    return { ok: false, code: "unknown" };
  }
  if (answer.error) {
    // Only the refusal code at the start of the message is read.
    return { ok: false, code: readSignUpRefusal(answer.error) };
  }

  const data = answer.data as Record<string, unknown> | null;
  if (
    data === null ||
    typeof data !== "object" ||
    !isUuid(data.customer_id) ||
    !isUuid(data.household_id) ||
    !isUuid(data.session_id)
  ) {
    return { ok: false, code: "unknown" };
  }
  return {
    ok: true,
    customerId: data.customer_id as string,
    householdId: data.household_id as string,
    sessionId: data.session_id as string,
  };
}

// ---------------------------------------------------------------------
// sign_in_with_code
// ---------------------------------------------------------------------

export type SignInArgs = {
  codeHash: string;
  tokenHash: string;
  visitorHash: string;
  maxWrongPer15Minutes: number;
  maxWrongPer24Hours: number;
  idleDays: number;
  absoluteDays: number;
};

export type SignInCallResult =
  | { status: "signed_in"; customerId: string; householdId: string }
  | { status: Exclude<SignInStatus, "signed_in"> }
  | { status: "unknown" };

/** Call sign_in_with_code once, with its 7 arguments in the migration's order. */
export async function signInWithCodeCall(args: SignInArgs, rpc: Rpc): Promise<SignInCallResult> {
  const answer = await call(rpc, "sign_in_with_code", {
    p_code_hash: args.codeHash,
    p_token_hash: args.tokenHash,
    p_visitor_hash: args.visitorHash,
    p_max_wrong_per_15_minutes: args.maxWrongPer15Minutes,
    p_max_wrong_per_24_hours: args.maxWrongPer24Hours,
    p_idle_days: args.idleDays,
    p_absolute_days: args.absoluteDays,
  });

  if (answer === null || answer.status === 0 || answer.error) {
    return { status: "unknown" };
  }

  const status = readSignInStatus(answer.data);
  if (status === "unknown") {
    return { status: "unknown" };
  }
  if (status === "signed_in") {
    const data = answer.data as Record<string, unknown>;
    if (!isUuid(data.customer_id) || !isUuid(data.household_id)) {
      return { status: "unknown" };
    }
    return { status: "signed_in", customerId: data.customer_id as string, householdId: data.household_id as string };
  }
  return { status };
}

// ---------------------------------------------------------------------
// get_session
// ---------------------------------------------------------------------

/** The signed-in person, as get_session gives them. */
export type SessionPerson = {
  customerId: string;
  householdId: string;
  householdName: string;
  fullName: string;
  role: "husband" | "wife";
};

/**
 * Call get_session with a token's fingerprint. Gives the person, or null
 * when there is no active session. A failure of any kind also gives null:
 * not signed in, never an error.
 */
export async function getSessionRowCall(tokenHash: string, rpc: Rpc): Promise<SessionPerson | null> {
  if (typeof tokenHash !== "string" || !HEX_64.test(tokenHash)) {
    return null;
  }
  const answer = await call(rpc, "get_session", { p_token_hash: tokenHash });
  if (answer === null || answer.status === 0 || answer.error) {
    return null;
  }

  const data = answer.data as Record<string, unknown> | null;
  if (
    data === null ||
    typeof data !== "object" ||
    !isUuid(data.customer_id) ||
    !isUuid(data.household_id) ||
    typeof data.household_name !== "string" ||
    typeof data.full_name !== "string" ||
    (data.role !== "husband" && data.role !== "wife")
  ) {
    return null;
  }
  return {
    customerId: data.customer_id as string,
    householdId: data.household_id as string,
    householdName: data.household_name,
    fullName: data.full_name,
    role: data.role,
  };
}

// ---------------------------------------------------------------------
// end_session
// ---------------------------------------------------------------------

/**
 * Call end_session with a token's fingerprint. Gives true only if the
 * database answered that it ended a session just now; false for anything
 * else, including a failure.
 */
export async function endSessionRowCall(tokenHash: string, rpc: Rpc): Promise<boolean> {
  if (typeof tokenHash !== "string" || !HEX_64.test(tokenHash)) {
    return false;
  }
  const answer = await call(rpc, "end_session", { p_token_hash: tokenHash });
  if (answer === null || answer.status === 0 || answer.error) {
    return false;
  }
  const data = answer.data as Record<string, unknown> | null;
  return data !== null && typeof data === "object" && data.ended === true;
}

// ---------------------------------------------------------------------
// get_access_code_material
// ---------------------------------------------------------------------

export type AccessCodeMaterial = { codeEncrypted: string; keyVersion: number };

/**
 * Call get_access_code_material for one person. Gives the locked copy and
 * its key version, or null when there is none or anything goes wrong.
 */
export async function getAccessCodeMaterialCall(customerId: string, rpc: Rpc): Promise<AccessCodeMaterial | null> {
  if (!isUuid(customerId)) {
    return null;
  }
  const answer = await call(rpc, "get_access_code_material", { p_customer_id: customerId });
  if (answer === null || answer.status === 0 || answer.error) {
    return null;
  }
  const data = answer.data as Record<string, unknown> | null;
  if (
    data === null ||
    typeof data !== "object" ||
    typeof data.code_encrypted !== "string" ||
    data.code_encrypted.length === 0 ||
    typeof data.key_version !== "number" ||
    !Number.isInteger(data.key_version) ||
    data.key_version < 1
  ) {
    return null;
  }
  return { codeEncrypted: data.code_encrypted, keyVersion: data.key_version };
}

// ---------------------------------------------------------------------
// get_profile
// ---------------------------------------------------------------------

/** One wallet or pot on the profile screen. */
export type ProfileAccount = {
  name: string;
  kind: "wallet" | "pot";
  // The 10-digit test account number, or null if the account has none.
  accountNumber: string | null;
};

/** What get_profile gives back, once checked. */
export type ProfileAnswer = {
  fullName: string;
  role: "husband" | "wife";
  phone: string;
  memberRole: "owner" | "partner";
  householdName: string;
  verificationStatus: string;
  verificationMethod: string;
  verifiedAt: string;
  ninLast3: string;
  bvnLast3: string;
  accounts: ProfileAccount[];
};

const PROFILE_MAX_ACCOUNTS = 20;
const LAST_3 = /^[0-9]{3}$/;
const TEST_PHONE = /^000[0-9]{8}$/;
const ACCOUNT_NUMBER = /^[0-9]{10}$/;
const ELEVEN_DIGITS = /[0-9]{11}/;

// True if any text anywhere in the value, other than the phone field at
// the top, holds 11 digits in a row: the length of a full NIN or BVN.
function holdsElevenDigits(value: unknown, isTop: boolean): boolean {
  if (typeof value === "string") {
    return ELEVEN_DIGITS.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => holdsElevenDigits(item, false));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) => !(isTop && key === "phone") && (ELEVEN_DIGITS.test(key) || holdsElevenDigits(item, false)),
    );
  }
  return false;
}

function readProfileAccount(value: unknown): ProfileAccount | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || (item.kind !== "wallet" && item.kind !== "pot")) {
    return null;
  }
  const number = item.account_number;
  if (number !== null && (typeof number !== "string" || !ACCOUNT_NUMBER.test(number))) {
    return null;
  }
  return { name: item.name, kind: item.kind, accountNumber: number };
}

/**
 * Call get_profile for one person. Gives the checked profile, or null when
 * there is none or anything goes wrong.
 *
 * The answer is checked by hand: every field must be there with the right
 * type, at most 20 accounts, and the last-3 values exactly 3 digits. Any
 * 11-digit number anywhere except the phone (which is a full NIN or BVN's
 * length) makes the whole answer count as malformed. Only the known
 * fields are copied across, so anything extra is dropped.
 */
export async function getProfileCall(customerId: string, rpc: Rpc): Promise<ProfileAnswer | null> {
  if (!isUuid(customerId)) {
    return null;
  }
  const answer = await call(rpc, "get_profile", { p_customer_id: customerId });
  if (answer === null || answer.status === 0 || answer.error) {
    return null;
  }
  const data = answer.data as Record<string, unknown> | null;
  if (data === null || typeof data !== "object" || Array.isArray(data) || holdsElevenDigits(data, true)) {
    return null;
  }
  if (
    typeof data.full_name !== "string" ||
    (data.role !== "husband" && data.role !== "wife") ||
    typeof data.phone !== "string" ||
    !TEST_PHONE.test(data.phone) ||
    (data.member_role !== "owner" && data.member_role !== "partner") ||
    typeof data.household_name !== "string" ||
    typeof data.verification_status !== "string" ||
    typeof data.verification_method !== "string" ||
    typeof data.verified_at !== "string" ||
    Number.isNaN(Date.parse(data.verified_at)) ||
    typeof data.nin_last3 !== "string" ||
    !LAST_3.test(data.nin_last3) ||
    typeof data.bvn_last3 !== "string" ||
    !LAST_3.test(data.bvn_last3) ||
    !Array.isArray(data.accounts) ||
    data.accounts.length > PROFILE_MAX_ACCOUNTS
  ) {
    return null;
  }
  const accounts: ProfileAccount[] = [];
  for (const item of data.accounts) {
    const account = readProfileAccount(item);
    if (account === null) {
      return null;
    }
    accounts.push(account);
  }
  return {
    fullName: data.full_name,
    role: data.role,
    phone: data.phone,
    memberRole: data.member_role,
    householdName: data.household_name,
    verificationStatus: data.verification_status,
    verificationMethod: data.verification_method,
    verifiedAt: data.verified_at,
    ninLast3: data.nin_last3,
    bvnLast3: data.bvn_last3,
    accounts,
  };
}
