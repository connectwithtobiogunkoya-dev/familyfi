// Turning a typed naira amount into whole kobo.
//
// A visitor types something like "1,000" or "1000.50" into a box. This
// file turns that text into a whole number of kobo (100 kobo = 1 naira),
// or refuses it with a clear reason.
//
// The text is read one character at a time and the result is built as a
// bigint, which is an exact whole number. At no point is the amount turned
// into an ordinary JavaScript number, because those are floating point and
// can be slightly wrong. (Counting how many characters there are, or which
// position we are at, uses ordinary numbers. Those are counts, not money.)

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

/** The most that can be moved at once: 100,000,000 kobo = ₦1,000,000.00. */
export const MAX_AMOUNT_KOBO = BigInt(100000000);

// ₦1,000,000 has seven digits before the decimal point. Anything with more
// naira digits is over the maximum, however long it is.
const MAX_NAIRA_DIGITS = 7;

/** Why an amount was refused. The screens turn each into one calm sentence. */
export type AmountProblem =
  | "empty" // nothing was typed
  | "malformed" // not written like an amount
  | "negative" // starts with a minus sign
  | "too_many_decimals" // more than two digits after the point
  | "zero" // an amount of nothing
  | "too_large"; // over the maximum

/** The error thrown when typed text is not an acceptable amount. */
export class AmountError extends Error {
  readonly problem: AmountProblem;

  constructor(problem: AmountProblem, message: string) {
    super(message);
    this.name = "AmountError";
    this.problem = problem;
  }
}

// True only for the ten plain digits 0 to 9. Digits from other writing
// systems (such as "١" or "１") are not accepted.
function isPlainDigit(character: string): boolean {
  return character.length === 1 && character >= "0" && character <= "9";
}

function isAllPlainDigits(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const character of text) {
    if (!isPlainDigit(character)) {
      return false;
    }
  }
  return true;
}

// Remove ordinary spaces from both ends, and nothing else. Tabs and line
// breaks are deliberately left in place, so they are refused later.
function trimOrdinarySpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === " ") {
    start += 1;
  }
  while (end > start && text[end - 1] === " ") {
    end -= 1;
  }
  return text.slice(start, end);
}

// Check the part before the decimal point and return its digits with any
// commas removed. For example "1,000" gives "1000".
function readNairaDigits(nairaPart: string): string {
  if (nairaPart.length === 0) {
    throw new AmountError("malformed", "An amount needs at least one digit before the decimal point.");
  }

  let digits: string;

  if (nairaPart.includes(",")) {
    // Commas are only allowed as thousands separators: the first group has
    // one to three digits, and every group after it has exactly three.
    const groups = nairaPart.split(",");
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const lengthIsRight = index === 0 ? group.length >= 1 && group.length <= 3 : group.length === 3;
      if (!lengthIsRight || !isAllPlainDigits(group)) {
        throw new AmountError("malformed", "Commas in an amount must separate groups of three digits, as in 1,000.");
      }
    }
    digits = groups.join("");
  } else {
    if (!isAllPlainDigits(nairaPart)) {
      throw new AmountError("malformed", "An amount may only contain the digits 0 to 9, commas and one decimal point.");
    }
    digits = nairaPart;
  }

  // "0" by itself is allowed (as in "0.50"). Extra zeros in front, as in
  // "007", are refused.
  if (digits.length > 1 && digits[0] === "0") {
    throw new AmountError("malformed", "An amount cannot start with extra zeros.");
  }

  return digits;
}

/**
 * Turn typed naira text into whole kobo.
 *
 *   parseNairaToKobo("1,000")    -> 100000n
 *   parseNairaToKobo("1000.5")   -> 100050n
 *   parseNairaToKobo("0.01")     -> 1n
 *
 * Throws an AmountError for anything that is not a plain, positive amount
 * of at most ₦1,000,000.00 with no more than two decimal places.
 */
export function parseNairaToKobo(text: string): bigint {
  if (typeof text !== "string") {
    throw new AmountError("malformed", "An amount must be given as text.");
  }

  const trimmed = trimOrdinarySpaces(text);

  if (trimmed.length === 0) {
    throw new AmountError("empty", "No amount was entered.");
  }

  if (trimmed[0] === "-") {
    throw new AmountError("negative", "An amount cannot be negative.");
  }

  // Split at the decimal point. There may be one point at most.
  const pointAt = trimmed.indexOf(".");
  const hasPoint = pointAt !== -1;
  const nairaPart = hasPoint ? trimmed.slice(0, pointAt) : trimmed;
  const koboPart = hasPoint ? trimmed.slice(pointAt + 1) : "";

  const nairaDigits = readNairaDigits(nairaPart);

  let koboDigits = "00";
  if (hasPoint) {
    // After a decimal point there must be one or two digits. "5." and
    // "1.2.3" are refused here, because what follows the first point is
    // either empty or not all digits.
    if (!isAllPlainDigits(koboPart)) {
      throw new AmountError("malformed", "After a decimal point there must be one or two digits.");
    }
    if (koboPart.length > 2) {
      throw new AmountError("too_many_decimals", "An amount can have at most two decimal places.");
    }
    // "5" after the point means 50 kobo, so pad on the right: "5" -> "50".
    koboDigits = koboPart.padEnd(2, "0");
  }

  // Too many naira digits means over the maximum, whatever the digits are.
  // Checking the count first also means a very long string of digits is
  // refused without ever being turned into a number.
  if (nairaDigits.length > MAX_NAIRA_DIGITS) {
    throw new AmountError("too_large", "That amount is over the maximum of ₦1,000,000.00.");
  }

  const kobo = BigInt(nairaDigits) * HUNDRED + BigInt(koboDigits);

  if (kobo > MAX_AMOUNT_KOBO) {
    throw new AmountError("too_large", "That amount is over the maximum of ₦1,000,000.00.");
  }

  if (kobo === ZERO) {
    throw new AmountError("zero", "An amount must be more than zero.");
  }

  return kobo;
}
