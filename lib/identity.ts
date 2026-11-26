// Checking the details typed at sign-up, and the simulated identity check.
//
// Every field is tidied and then checked. The result says, for each field
// with a problem, which problem it is, with one fixed sentence. No sentence
// ever repeats what was typed.
//
// The rules match the database function create_household, so the app and
// the database never disagree about whether a sign-up is allowed:
//   * full name: 2 to 100 characters once the spaces at each end are gone
//   * phone, NIN, BVN: test numbers, 000 followed by 8 digits (for the
//     phone, spaces and hyphens typed in the middle are tidied out first)
//   * date of birth: a real date written YYYY-MM-DD, from 1900, not in the
//     future, and 18 or over by the calendar in Lagos
//   * role: husband or wife
//   * household name: optional, at most 60 characters
//   * the test-terms box: must be ticked
//
// The simulated identity check: a NIN or BVN ending in 99 does not pass.
// It is only looked at once every field is in the right form, and it is a
// different outcome from a field problem.

/** What the sign-up form sends, before any checking. */
export type IdentityInput = {
  fullName: unknown;
  phone: unknown;
  dateOfBirth: unknown;
  role: unknown;
  nin: unknown;
  bvn: unknown;
  householdName: unknown;
  testTermsAccepted: unknown;
};

export type IdentityField = keyof IdentityInput;

/** Why a field was not accepted. */
export type FieldProblem =
  | "missing"
  | "too_short"
  | "too_long"
  | "bad_characters"
  | "not_test_number"
  | "not_a_date"
  | "before_1900"
  | "in_future"
  | "under_18"
  | "not_a_role"
  | "not_ticked";

export type FieldError = { problem: FieldProblem; message: string };

/** The details once tidied and accepted. */
export type IdentityDetails = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  role: "husband" | "wife";
  nin: string;
  bvn: string;
  // An empty string means "use the default", which the database makes from
  // the last word of the full name.
  householdName: string;
};

export type IdentityResult =
  | { outcome: "field_errors"; fields: Partial<Record<IdentityField, FieldError>> }
  | { outcome: "not_verified" }
  | { outcome: "passed"; details: IdentityDetails };

const TEST_NUMBER = /^000[0-9]{8}$/;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const CONTROL_CHARACTER = /\p{Cc}/u;
const EARLIEST_DATE_OF_BIRTH = "1900-01-01";

// The fixed sentence for each field and problem. Only these sentences are
// ever shown, and none of them contains anything that was typed.
const SENTENCES: Record<IdentityField, Partial<Record<FieldProblem, string>>> = {
  fullName: {
    missing: "Enter a full name.",
    too_short: "The full name must be at least 2 characters.",
    too_long: "The full name can be at most 100 characters.",
    bad_characters: "The full name contains a character that cannot be used.",
  },
  phone: {
    missing: "Enter a test phone number.",
    not_test_number: "Use a test phone number: 11 digits starting with 000.",
  },
  dateOfBirth: {
    missing: "Enter a date of birth.",
    not_a_date: "Enter the date of birth as a real date.",
    before_1900: "Enter a date of birth from 1900 onwards.",
    in_future: "The date of birth cannot be in the future.",
    under_18: "You must be 18 or over to sign up.",
  },
  role: {
    missing: "Choose Husband or Wife.",
    not_a_role: "Choose Husband or Wife.",
  },
  nin: {
    missing: "Enter a test NIN.",
    not_test_number: "Use a test NIN: 11 digits starting with 000.",
  },
  bvn: {
    missing: "Enter a test BVN.",
    not_test_number: "Use a test BVN: 11 digits starting with 000.",
  },
  householdName: {
    too_long: "The household name can be at most 60 characters.",
    bad_characters: "The household name contains a character that cannot be used.",
  },
  testTermsAccepted: {
    not_ticked: "Tick the box to confirm you understand this is a test environment.",
  },
};

function fieldError(field: IdentityField, problem: FieldProblem): FieldError {
  return { problem, message: SENTENCES[field][problem] ?? "Check this detail and try again." };
}

// Length in characters as the database counts them (one per character,
// even for letters made of two UTF-16 units).
function characterCount(text: string): number {
  return [...text].length;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const LAGOS_CALENDAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date on a calendar in Lagos, as YYYY-MM-DD. */
export function lagosDate(now: Date): string {
  const parts = LAGOS_CALENDAR.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Is someone born on this date 18 or over on today's date in Lagos?
 *
 * "18 years ago" is worked out the same way the database does: the same
 * month and day 18 years earlier, or the last day of that month when the
 * day does not exist. So someone born on 29 February turns 18 on 1 March
 * in a year with no 29 February.
 */
export function isEighteenOrOver(dateOfBirth: string, now: Date): boolean {
  const [year, month, day] = lagosDate(now).split("-").map(Number);
  const cutoffYear = year - 18;
  const cutoffDay = Math.min(day, daysInMonth(cutoffYear, month));
  const cutoff = `${String(cutoffYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`;
  // Dates written YYYY-MM-DD sort correctly as text.
  return dateOfBirth <= cutoff;
}

function readText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function checkTestNumber(field: "nin" | "bvn" | "phone", value: string | null): FieldError | string {
  if (value === null || value === "") {
    return fieldError(field, "missing");
  }
  return TEST_NUMBER.test(value) ? value : fieldError(field, "not_test_number");
}

/**
 * Check the typed sign-up details.
 *
 * "now" is passed in, so tests can fix the date. The order of outcomes:
 *   1. If any field has a problem: "field_errors", one entry per field.
 *   2. Otherwise, if the NIN or BVN ends in 99: "not_verified".
 *   3. Otherwise: "passed", with the tidied details.
 */
export function checkIdentity(input: IdentityInput, now: Date): IdentityResult {
  const fields: Partial<Record<IdentityField, FieldError>> = {};

  // Full name.
  const fullName = readText(input.fullName);
  if (fullName === null || fullName === "") {
    fields.fullName = fieldError("fullName", "missing");
  } else if (CONTROL_CHARACTER.test(fullName)) {
    fields.fullName = fieldError("fullName", "bad_characters");
  } else if (characterCount(fullName) < 2) {
    fields.fullName = fieldError("fullName", "too_short");
  } else if (characterCount(fullName) > 100) {
    fields.fullName = fieldError("fullName", "too_long");
  }

  // Phone: spaces and hyphens typed in the middle are tidied out first.
  const rawPhone = readText(input.phone);
  const phone = checkTestNumber("phone", rawPhone === null ? null : rawPhone.replace(/[ -]/g, ""));
  if (typeof phone !== "string") {
    fields.phone = phone;
  }

  // Date of birth.
  const dateOfBirth = readText(input.dateOfBirth);
  if (dateOfBirth === null || dateOfBirth === "") {
    fields.dateOfBirth = fieldError("dateOfBirth", "missing");
  } else {
    const match = ISO_DATE.exec(dateOfBirth);
    const year = match ? Number(match[1]) : 0;
    const month = match ? Number(match[2]) : 0;
    const day = match ? Number(match[3]) : 0;
    if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      fields.dateOfBirth = fieldError("dateOfBirth", "not_a_date");
    } else if (dateOfBirth < EARLIEST_DATE_OF_BIRTH) {
      fields.dateOfBirth = fieldError("dateOfBirth", "before_1900");
    } else if (dateOfBirth > lagosDate(now)) {
      fields.dateOfBirth = fieldError("dateOfBirth", "in_future");
    } else if (!isEighteenOrOver(dateOfBirth, now)) {
      fields.dateOfBirth = fieldError("dateOfBirth", "under_18");
    }
  }

  // Role.
  const role = input.role;
  if (role === undefined || role === null || role === "") {
    fields.role = fieldError("role", "missing");
  } else if (role !== "husband" && role !== "wife") {
    fields.role = fieldError("role", "not_a_role");
  }

  // NIN and BVN.
  const nin = checkTestNumber("nin", readText(input.nin));
  if (typeof nin !== "string") {
    fields.nin = nin;
  }
  const bvn = checkTestNumber("bvn", readText(input.bvn));
  if (typeof bvn !== "string") {
    fields.bvn = bvn;
  }

  // Household name: optional.
  const householdName = readText(input.householdName) ?? "";
  if (CONTROL_CHARACTER.test(householdName)) {
    fields.householdName = fieldError("householdName", "bad_characters");
  } else if (characterCount(householdName) > 60) {
    fields.householdName = fieldError("householdName", "too_long");
  }

  // The test-terms box.
  if (input.testTermsAccepted !== true) {
    fields.testTermsAccepted = fieldError("testTermsAccepted", "not_ticked");
  }

  if (Object.keys(fields).length > 0) {
    return { outcome: "field_errors", fields };
  }

  // Every field is in the right form. Now the simulated identity check.
  const acceptedNin = nin as string;
  const acceptedBvn = bvn as string;
  if (acceptedNin.endsWith("99") || acceptedBvn.endsWith("99")) {
    return { outcome: "not_verified" };
  }

  return {
    outcome: "passed",
    details: {
      fullName: fullName as string,
      phone: phone as string,
      dateOfBirth: dateOfBirth as string,
      role: role as "husband" | "wife",
      nin: acceptedNin,
      bvn: acceptedBvn,
      householdName,
    },
  };
}

// ---------------------------------------------------------------------
// "Fill in test details"
// ---------------------------------------------------------------------

const FIRST_NAMES = [
  "Adaeze", "Chinedu", "Funmilayo", "Ibrahim", "Kemi", "Musa", "Ngozi", "Olumide",
  "Tolu", "Zainab", "Emeka", "Halima", "Segun", "Amaka", "Yusuf", "Bisi",
];

const SURNAMES = [
  "Okafor", "Adebayo", "Bello", "Eze", "Nwosu", "Ogunleye", "Danjuma", "Okoro",
  "Lawal", "Afolabi", "Umeh", "Garba", "Adeleke", "Obi", "Salami", "Ibe",
];

/** A random number from 0 up to (but not including) 1, like Math.random. */
export type RandomSource = () => number;

function pick<T>(random: RandomSource, items: readonly T[]): T {
  const value = random();
  if (!(value >= 0 && value < 1)) {
    throw new RangeError("The random source must give a number from 0 up to 1.");
  }
  return items[Math.floor(value * items.length)];
}

function randomDigits(random: RandomSource, count: number): string {
  let digits = "";
  for (let i = 0; i < count; i += 1) {
    digits += pick(random, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  }
  return digits;
}

/**
 * Made-up test details for the "Fill in test details" button: a name from
 * a list, a test phone number, a date of birth between 21 and 65 years
 * ago, Husband or Wife, and a NIN and BVN that never end in 99 (so the
 * simulated check always passes). The test-terms box is not included:
 * ticking it is left to the person.
 *
 * The random source is passed in, so tests can make the results repeat.
 */
export function generateTestDetails(random: RandomSource, now: Date): IdentityDetails {
  const firstName = pick(random, FIRST_NAMES);
  const surname = pick(random, SURNAMES);

  const [lagosYear] = lagosDate(now).split("-").map(Number);
  const age = 21 + pick(random, Array.from({ length: 45 }, (_, i) => i));
  const year = lagosYear - age;
  const month = 1 + pick(random, Array.from({ length: 12 }, (_, i) => i));
  const day = 1 + pick(random, Array.from({ length: 28 }, (_, i) => i));

  // The last digit is never 9, so the number can never end in 99.
  const testIdNumber = () => `000${randomDigits(random, 7)}${pick(random, ["0", "1", "2", "3", "4", "5", "6", "7", "8"])}`;

  return {
    fullName: `${firstName} ${surname}`,
    phone: `000${randomDigits(random, 8)}`,
    dateOfBirth: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    role: pick(random, ["husband", "wife"] as const),
    nin: testIdNumber(),
    bvn: testIdNumber(),
    householdName: `${surname} household`,
  };
}
