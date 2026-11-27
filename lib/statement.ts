// Statement helpers for FamilyFi.
//
// These are the parts of reading a statement that do not need the
// database, kept apart so they can be tested on their own:
//   * normaliseAccountId : checks an account id taken from an address,
//                          such as /app/accounts/<id>
//   * toStatementLine    : checks one row from the database and gives it
//                          a known shape, keeping every amount as text
//
// Nothing here talks to the database or reads any secret.

/** One line of a statement, ready for the screen. */
export type StatementLine = {
  description: string;
  // When the transaction was saved, as the database sent it, for example
  // "2026-11-12T10:15:00.123456+00:00".
  created_at: string;
  // Whole kobo as text, for example "-400000". Positive means money in,
  // negative means money out. Text on purpose, so it is never turned into
  // a floating point number. Give it to formatNaira to display it.
  amount_kobo: string;
  // The account's balance straight after this line, as whole kobo text.
  balance_after_kobo: string;
  // The full name of the member who made the line's transaction, exactly
  // as the view gives it. Left out when the view gives none: older lines,
  // and the bank side of adding money.
  made_by_name?: string;
};

// A UUID is 36 characters: 32 hexadecimal digits in groups of 8-4-4-4-12,
// with a hyphen between the groups.
const UUID_LENGTH = 36;
const HYPHEN_POSITIONS = [8, 13, 18, 23];

function isHexDigit(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}

/**
 * Check an account id taken from an address.
 *
 * Returns the id in lowercase if it is a properly formed UUID, written
 * exactly as 8-4-4-4-12 hexadecimal digits with hyphens and nothing else.
 * Returns null for anything else: other text, a UUID with extra characters
 * before or after it, a list, a number, nothing at all.
 *
 * Each character is checked one by one, so nothing can slip through at
 * the ends, such as a trailing line break.
 */
export function normaliseAccountId(value: unknown): string | null {
  if (typeof value !== "string" || value.length !== UUID_LENGTH) {
    return null;
  }

  for (let position = 0; position < UUID_LENGTH; position += 1) {
    const character = value[position];
    if (HYPHEN_POSITIONS.includes(position)) {
      if (character !== "-") {
        return null;
      }
    } else if (!isHexDigit(character)) {
      return null;
    }
  }

  return value.toLowerCase();
}

// True for a whole number written as text: an optional minus sign, then
// one or more of the plain digits 0 to 9, and nothing else at all.
function isWholeNumberText(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const start = value[0] === "-" ? 1 : 0;
  if (start === value.length) {
    return false;
  }
  for (let position = start; position < value.length; position += 1) {
    const character = value[position];
    if (character < "0" || character > "9") {
      return false;
    }
  }
  return true;
}

/**
 * Check one row from the account_statements view and give it a known
 * shape. Only the fields a statement line needs are kept: the four
 * always there, and made_by_name when the view gives one. Anything else in
 * the row (such as seq) is left behind.
 *
 * Throws if the row is not what the database should send, so a wrong
 * value can never reach the screen.
 */
export function toStatementLine(row: unknown): StatementLine {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("The database returned a statement line in an unexpected form.");
  }

  const { description, created_at, amount_kobo, balance_after_kobo, made_by_name } = row as Record<string, unknown>;

  if (
    typeof description !== "string" ||
    typeof created_at !== "string" ||
    created_at.length === 0 ||
    !isWholeNumberText(amount_kobo) ||
    !isWholeNumberText(balance_after_kobo)
  ) {
    throw new Error("The database returned a statement line in an unexpected form.");
  }

  // Who made it: text from the view, or nothing. Anything else is refused.
  if (made_by_name !== undefined && made_by_name !== null && typeof made_by_name !== "string") {
    throw new Error("The database returned a statement line in an unexpected form.");
  }

  const line: StatementLine = { description, created_at, amount_kobo, balance_after_kobo };
  if (typeof made_by_name === "string" && made_by_name.trim() !== "") {
    line.made_by_name = made_by_name;
  }
  return line;
}

/** The small "by <full name>" line for a statement line, or null when the view gave no name. */
export function madeByLine(line: StatementLine): string | null {
  return line.made_by_name === undefined ? null : `by ${line.made_by_name}`;
}

// ---------------------------------------------------------------------
// Showing a statement
// ---------------------------------------------------------------------

// Month names are written out here instead of taken from the browser or
// server, because some systems write September as "Sept" and others as
// "Sep". This way every date looks the same everywhere.
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Reads a moment in time as it is on a clock in Lagos. Nigeria does not
// change its clocks in summer, but the time zone database is used anyway,
// so the rule lives in one trusted place.
const LAGOS_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Show a timestamp from the database in Nigerian time, for example
 * "2026-11-12T10:15:00.123456+00:00" -> "12 Nov 2026, 11:15".
 *
 * Seconds are dropped, never rounded up. If the text cannot be read as a
 * time, it gives "Date unknown" rather than a wrong date.
 */
export function formatStatementDate(timestamp: unknown): string {
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    return "Date unknown";
  }

  const moment = Date.parse(timestamp);
  if (Number.isNaN(moment)) {
    return "Date unknown";
  }

  const parts = LAGOS_CLOCK.formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";

  // These are calendar numbers (day 1 to 31, month 1 to 12), not money.
  const day = Number(part("day"));
  const month = MONTH_NAMES[Number(part("month")) - 1];
  const year = part("year");
  const hour = part("hour").padStart(2, "0");
  const minute = part("minute").padStart(2, "0");

  if (!month || !Number.isInteger(day) || year === "" || hour === "" || minute === "") {
    return "Date unknown";
  }

  return `${day} ${month} ${year}, ${hour}:${minute}`;
}

/** How one line's amount is shown: a word and the signed amount. */
export type AmountDisplay = {
  // "In" for money arriving, "Out" for money leaving. Shown as a word so
  // the meaning never depends on colour alone.
  direction: "In" | "Out";
  // The amount with its sign, for example "+₦100,000.00" or "-₦40,000.00".
  text: string;
};

/**
 * Decide how a line's amount is shown. Takes whole kobo as text and a
 * formatter (formatNaira) passed in, so this file stays free of money
 * formatting and the formatter is used unchanged.
 *
 * formatNaira already puts a minus sign in front of negative amounts
 * ("-₦40,000.00"). Positive amounts get a plus sign in front here.
 */
export function describeAmount(amountKobo: string, format: (kobo: string) => string): AmountDisplay {
  if (amountKobo.startsWith("-")) {
    return { direction: "Out", text: format(amountKobo) };
  }
  return { direction: "In", text: `+${format(amountKobo)}` };
}

/**
 * The safety check before showing "Balance after".
 *
 * The account's current balance and the newest line's "balance after" are
 * read separately, so they should match. If they do not (for example,
 * money moved between the two reads), the screen hides the "Balance after"
 * figures rather than show numbers that might be wrong.
 *
 * Lines are newest first. With no lines at all, they agree only when the
 * balance is exactly "0". Both values are whole-kobo text from the
 * database, compared exactly as text.
 */
export function balancesAgree(balanceKobo: string, lines: StatementLine[]): boolean {
  if (lines.length === 0) {
    return balanceKobo === "0";
  }
  return lines[0].balance_after_kobo === balanceKobo;
}
