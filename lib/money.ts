// Money formatting for FamilyFi.
//
// Money is stored as whole kobo (100 kobo = 1 naira). This file turns a
// whole number of kobo into text a person can read, such as "₦15,000.00".
//
// It uses whole-number arithmetic only. JavaScript's ordinary numbers are
// floating point, which can be slightly wrong for large amounts, so they
// are refused here. Amounts are handled as bigint, which is an exact whole
// number of any size.

const ZERO = BigInt(0);
const KOBO_PER_NAIRA = BigInt(100);

// A minus sign (optional) followed by one or more digits, and nothing else.
const WHOLE_NUMBER = /^-?[0-9]+$/;

/**
 * Turn whole kobo into naira text.
 *
 *   formatNaira("1500000")  -> "₦15,000.00"
 *   formatNaira(BigInt(1))  -> "₦0.01"
 *   formatNaira("-100000")  -> "-₦1,000.00"
 *
 * Accepts a bigint, or a string of digits (the database sends text).
 * Throws an error for anything else, including ordinary numbers.
 */
export function formatNaira(kobo: bigint | string): string {
  let amount: bigint;

  if (typeof kobo === "bigint") {
    amount = kobo;
  } else if (typeof kobo === "string") {
    if (!WHOLE_NUMBER.test(kobo)) {
      throw new TypeError(
        `formatNaira needs a whole number of kobo, such as "1500000", but got "${kobo}". ` +
          "Decimals, spaces, letters and empty text are not allowed.",
      );
    }
    amount = BigInt(kobo);
  } else {
    throw new TypeError(
      `formatNaira needs kobo as a bigint or a string of digits, but got a ${typeof kobo}. ` +
        "Ordinary numbers are refused because they can lose precision.",
    );
  }

  const isNegative = amount < ZERO;
  const absolute = isNegative ? -amount : amount;

  // Whole-number division: how many full naira, and how many kobo are left.
  const naira = absolute / KOBO_PER_NAIRA;
  const leftoverKobo = absolute % KOBO_PER_NAIRA;

  const nairaText = addThousandsCommas(naira.toString());
  const koboText = leftoverKobo.toString().padStart(2, "0");

  return `${isNegative ? "-" : ""}₦${nairaText}.${koboText}`;
}

// "15000" -> "15,000". Works on the digits as text, from the right,
// three at a time.
function addThousandsCommas(digits: string): string {
  let result = "";
  for (let end = digits.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3);
    const group = digits.slice(start, end);
    result = result === "" ? group : `${group},${result}`;
  }
  return result;
}
