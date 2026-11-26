// NUBAN account numbers for FamilyFi.
//
// Every wallet and pot has a 10-digit test account number: a 9-digit
// serial number followed by one check digit. The check digit follows the
// Central Bank of Nigeria's Revised Standards on NUBAN (2020), exactly as
// the database function nuban_check_digit does:
//
//   1. Pad the institution code to 6 digits with zeros in front.
//   2. Put it in front of the 9-digit serial: 15 digits.
//   3. Multiply the digits by 3,7,3,3,7,3,3,7,3,3,7,3,3,7,3 and add them.
//   4. The check digit is 10 minus (the sum's remainder after dividing by
//      10), or 0 when that is 10.
//
// The CBN's own example: code 011 (or 000011) with serial 000001457 gives
// 9, so the account number is 0000014579.
//
// FamilyFi's test numbers use the institution code 000.

/** The institution code FamilyFi's test account numbers use. */
export const TEST_INSTITUTION_CODE = "000";

const WEIGHTS = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];

function isDigits(value: unknown, minLength: number, maxLength: number): value is string {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    return false;
  }
  for (const character of value) {
    if (character < "0" || character > "9") {
      return false;
    }
  }
  return true;
}

/**
 * The NUBAN check digit for an institution code (1 to 6 digits) and a
 * 9-digit serial number. Throws for anything else.
 */
export function nubanCheckDigit(institutionCode: string, serial: string): number {
  if (!isDigits(institutionCode, 1, 6)) {
    throw new RangeError("The institution code must be 1 to 6 digits.");
  }
  if (!isDigits(serial, 9, 9)) {
    throw new RangeError("The serial number must be exactly 9 digits.");
  }

  const digits = institutionCode.padStart(6, "0") + serial;
  let sum = 0;
  for (let position = 0; position < 15; position += 1) {
    // A single digit, so turning it into a number is exact.
    sum += Number(digits[position]) * WEIGHTS[position];
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Is this a 10-digit account number whose last digit is the right check
 * digit for the given institution code? Anything that is not exactly 10
 * digits gives false. A bad institution code throws, because that is a
 * mistake in the app, not in the number.
 */
export function isValidAccountNumber(accountNumber: unknown, institutionCode: string): boolean {
  if (!isDigits(institutionCode, 1, 6)) {
    throw new RangeError("The institution code must be 1 to 6 digits.");
  }
  if (!isDigits(accountNumber, 10, 10)) {
    return false;
  }
  return nubanCheckDigit(institutionCode, accountNumber.slice(0, 9)) === Number(accountNumber[9]);
}
