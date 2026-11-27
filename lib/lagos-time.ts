// Dates and times as they are on a clock in Lagos, whatever the server's
// own clock or time zone.
//
// Used for "Stops working: <date and time>" on an invite code. The parts
// come from Intl.DateTimeFormat with the options approved in
// docs/slice-6-plan.md, and are joined here in one fixed way:
//
//   29 November 2026, 14:05
//
// The words Intl puts between the parts differ between versions (some
// write "29 November 2026 at 14:05"), so only the parts are taken from it.
// A 24-hour clock, so there is no am or pm to misread.

const LAGOS_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A moment as a Lagos date and time, for example "29 November 2026, 14:05". Null if it is not a moment. */
export function lagosDateTime(moment: string | Date): string | null {
  const time = moment instanceof Date ? moment.getTime() : typeof moment === "string" ? Date.parse(moment) : Number.NaN;
  if (Number.isNaN(time)) {
    return null;
  }
  const parts: Record<string, string> = {};
  for (const part of LAGOS_DATE_TIME.formatToParts(new Date(time))) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }
  const { day, month, year, hour, minute } = parts;
  if (!day || !month || !year || !hour || !minute) {
    return null;
  }
  return `${day} ${month} ${year}, ${hour}:${minute}`;
}

/** The approved line for an invite's end: "Stops working: 29 November 2026, 14:05". */
export function stopsWorkingLine(expiresAt: string): string | null {
  const shown = lagosDateTime(expiresAt);
  return shown === null ? null : `Stops working: ${shown}`;
}
