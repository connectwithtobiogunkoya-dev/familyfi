// Which household the app is showing and changing right now.
//
// TEMPORARY. Until people can sign in, the app always uses the retired
// Adeyemi household. Slice 5, step 11 replaces this with the household of
// the signed-in person, taken from their session on the server.
//
// This is the only file that may hold that household's id. Every page and
// server action that needs a household asks getCurrentHouseholdId(); none
// of them reads a household from the address bar or from a form.
import "server-only";

// The household seeded in supabase/seed.sql, retired from the app in
// Slice 5, step 11.
const RETIRED_ADEYEMI_HOUSEHOLD_ID = "a0000000-0000-4000-8000-000000000001";

/** The household every page and action uses, for now. */
export function getCurrentHouseholdId(): string {
  return RETIRED_ADEYEMI_HOUSEHOLD_ID;
}
