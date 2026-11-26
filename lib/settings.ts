// The kill switch for FamilyFi.
//
// One server setting, WRITES_ENABLED, decides whether the app is allowed
// to move money. It is a safety catch: when it is off, the screens hide
// their money buttons and the server refuses every attempt to post a
// transaction, even one sent by hand.
//
// The switch is ON only when the setting is exactly the four lowercase
// letters "true". Anything else counts as OFF: a missing setting, an empty
// one, "TRUE", "True", "yes", "1", or "true" with spaces around it. The
// rule is strict on purpose, so a typing mistake leaves the app read-only
// instead of open.

/**
 * Decide whether one raw setting value means "writes are on".
 * Kept separate from the function below so it can be tested with any
 * value, without changing the real settings.
 */
export function isWritesEnabledValue(value: unknown): boolean {
  return value === "true";
}

/**
 * Are money movements allowed right now?
 *
 * Reads the server setting each time it is called, so it always reflects
 * the settings the running server was started with. Every screen and
 * every server function that can move money must ask this first.
 */
export function writesEnabled(): boolean {
  return isWritesEnabledValue(process.env.WRITES_ENABLED);
}

// ---------------------------------------------------------------------
// The sign-up switch
// ---------------------------------------------------------------------
//
// A second, separate switch, SIGNUPS_ENABLED, decides whether new people
// may sign up. It follows exactly the same rule as WRITES_ENABLED: ON only
// for the exact text "true", OFF for anything else.

/** The settings signupsEnabled reads. */
export type SignupSettings = { SIGNUPS_ENABLED?: string; [name: string]: string | undefined };

/**
 * May new people sign up right now?
 *
 * Reads SIGNUPS_ENABLED from the settings given, or from the real server
 * settings when none are given, at the moment it is called. Tests pass
 * stand-in settings so the real ones are never touched.
 */
export function signupsEnabled(settings: SignupSettings = process.env): boolean {
  return settings.SIGNUPS_ENABLED === "true";
}
