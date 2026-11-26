# Slice 5 plan: sign-up, sign-in and a household of your own

Status: plan approved with amendments. Step 1 (wording) is the only step
done. Nothing else in this document has been built.

## Goal

A visitor opens the app, signs up with typed details, goes through a
simulated identity check, and lands on their own household at ₦0.00 with a
wallet and three pots. They can sign out and sign back in with an access
code. Their household is theirs alone. The Adeyemi family is retired from
the app.

## Decisions recorded

These were the open questions. All are now answered.

1. **Phone number.** Restricted to a clearly marked test pattern, like the
   NIN and BVN: 11 digits starting with `000` (section A explains why).
   Names and dates of birth stay free text, and the form asks for made-up
   ones.
2. **A failed check.** When the NIN or BVN ends in 99, nothing is created.
3. **Storing access codes.** Option A: locked with a server key (section C).
4. **Limits and session lengths.** Approved exactly as written in sections D
   and F. The only change: the 300 cap counts customers, not households, so
   the Adeyemi household is not counted.
5. **CLAUDE.md and README.md.** Both updated in step 1. Typed test details
   replace generated identities, the access code format changes, and the
   "Use demo account" button described in the old CLAUDE.md is dropped.
6. **Bank code.** 000, for the check digit.

## A. Data model

All new tables keep Row Level Security switched on with no policies, as
now. No existing migration is edited. New migration files, all dated after
20261126090100:

| File | What it holds | Runs in plain Postgres? |
|---|---|---|
| `20261126120000_customers_and_sessions.sql` | The new tables, their rules and the locks against editing | Yes |
| `20261126120100_create_household.sql` | Account number helpers and the create_household function | Yes |
| `20261126120200_sign_in_and_sessions.sql` | The sign-in, session-check, sign-out and clean-up functions | Yes |
| `20261126120300_grants.sql` | Who may call the new functions (server key only) | Supabase only |

The grants are in a file of their own because the roles `anon`,
`authenticated` and `service_role` exist only on Supabase. That keeps the
other three files testable in an ordinary Postgres.

### New tables

**customers**: one row per person.

| Column | Type | Rule |
|---|---|---|
| id | uuid | generated |
| full_name | text | required, 2 to 100 characters after trimming spaces |
| phone | text | must be exactly `000` followed by 8 digits (the test pattern) |
| date_of_birth | date | required; "18 or over" is checked inside create_household, using today's date in Lagos (a table rule cannot use today's date) |
| role | text | only `husband` or `wife` |
| nin | text | must be exactly `000` followed by 8 digits |
| bvn | text | must be exactly `000` followed by 8 digits |
| verification_status | text | only `verified` |
| verification_method | text | only `simulated` |
| verified_at | timestamptz | required |
| test_terms_accepted_at | timestamptz | required (see "other fields" below) |
| created_at | timestamptz | database default |

The phone, NIN and BVN rules are written into the table itself, so even a
mistake in the app can never store a number that could belong to a real
person. Phone, NIN and BVN are not unique. If they were, a visitor could
find out which test numbers others had used.

**The test phone pattern, and how I chose it.** 11 digits starting with
`000`, for example `000 1234 5678`, stored without spaces.

- **It cannot be a real Nigerian number.** In Nigeria's numbering plan, the
  first 0 is only the trunk prefix, and the national number after it never
  starts with 0. Real numbers look like 080…, 070…, 090…; no real number
  starts 00.
- **It is not an international number either.** Written with `+234` in
  front it would be invalid, so it is stored and shown only in this local
  test form.
- **It matches the NIN and BVN pattern.** The same rule for all three test
  numbers is easy to explain on the form and to check in one place.
- **The 99 rule does not apply to the phone.** Only the NIN and BVN decide
  the simulated check.

**household_members**: who belongs to which household, so a partner can
join in a later slice.

| Column | Rule |
|---|---|
| household_id | links to households |
| customer_id | links to customers; unique, so a person belongs to one household |
| member_role | `owner` now, `partner` later |
| joined_at | database default |

One owner per household, enforced by a unique rule on household_id where
member_role is `owner`. The partner rules, such as at most one partner, come
with the invite slice.

**access_codes**: one per person.

| Column | Rule |
|---|---|
| customer_id | primary key, links to customers |
| code_hash | 64 hexadecimal characters, unique; used to find the person at sign-in |
| code_encrypted | the code locked with the server key, so it can be shown again (section C) |
| key_version | a small whole number, at least 1; which version of the server key locked this code, so the key can be changed later |
| created_at | database default |

**sessions**: one row per signed-in browser.

| Column | Rule |
|---|---|
| id | uuid, generated |
| customer_id | links to customers |
| token_hash | 64 hexadecimal characters, unique. The browser holds the token; the database keeps only its fingerprint |
| created_at, last_used_at | database defaults |
| idle_expires_at | when the session ends if unused |
| absolute_expires_at | when the session ends no matter what |
| ended_at | set when the person signs out; empty while active |

**account_numbers**: one 10-digit number for each wallet and pot.

| Column | Rule |
|---|---|
| account_id | primary key, links to accounts |
| account_number | exactly 10 digits, unique |
| created_at | database default |

Account numbers sit in their own table so the existing accounts table and
its rules stay untouched. A trigger refuses a number for a bank_source
account. Account numbers and access codes cannot be edited or deleted, the
same way entries cannot.

**auth_attempts**: the counter for the limits in section F.

| Column | Rule |
|---|---|
| id | generated |
| kind | `sign_up` or `sign_in_failed` |
| visitor_hash | a fingerprint of the visitor's internet address (IP), never the address itself |
| created_at | database default |

This table is not part of the ledger.

- **Who clears old rows, and when.** A function, `clean_up_auth_attempts`,
  in migration 3, removes rows older than 7 days.
- **When it runs.** create_household and the sign-in function call it each
  time they run, so the table never grows far.
- **No schedule yet.** A scheduled clean-up can replace this in a later
  slice. The limits only ever look back 24 hours, so a 7-day-old row is
  never needed.

### Account numbers: the NUBAN check digit (2020 standard)

The method in the Central Bank of Nigeria's Revised Standards on Nigeria
Uniform Bank Account Number (NUBAN) for Banks and Other Financial
Institutions (2020):

- Source: https://www.cbn.gov.ng/Out/2020/PSMD/REVISED%20STANDARDS%20ON%20NIGERIA%20UNIFORM%20BANK%20ACCOUNT%20NUMBER%20(NUBAN)%20FOR%20BANKS%20AND%20OTHER%20FINANCIAL%20INSTITUTIONS%20.pdf
- Original 2010 proposal: https://cbn.gov.ng/OUT/2010/CIRCULARS/BSPD/NUBAN%20PROPOSAL%20-%2020091010%20_FINAL%20UPLOAD_.PDF

The method:

1. Pad the institution code to 6 digits with zeros in front. A 3-digit bank
   code such as 011 becomes 000011. FamilyFi's code, 000, becomes 000000.
2. Put the 6-digit code in front of the 9-digit serial number: 15 digits.
3. Multiply the 15 digits by the weights
   3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3 and add up the results.
4. Divide by 10 and keep the remainder. The check digit is 10 minus that
   remainder, and 0 when the answer is 10.
5. The account number is the 9-digit serial followed by the check digit:
   10 digits.

**Same answer as the older 3-digit method.** For a 3-digit code, the padding
adds three zeros at the front, and a zero times any weight adds nothing.
The remaining 12 digits get the same weights as before, because the
weights repeat every three places. So the result is the same as the
original 3-digit method.

**Worked examples, both kept as tests:**

- The CBN's own example: bank code 011, serial 000001457, account number
  0000014579. The 12 weighted digits add up to 81; the remainder is 1, and
  10 − 1 = 9.
- The same example in its 6-digit form: code 000011 with serial 000001457
  must also give check digit 9 and 0000014579.

**FamilyFi's code, 000000.** Its digits add nothing, so the check digit
depends on the serial alone. Serial numbers are random, so they reveal
nothing about how many households exist. A number that is already taken is
drawn again. A 10-digit number with a valid check digit for code 000000
could still happen to match a real account at a real bank, so the screens
label these "test account number".

### Other minimum fields, and why

- **Household name** (optional, up to 60 characters). The /app heading says
  "The Adeyemi Family" today, written into the page. Each household needs
  its own heading. If it is left empty, it becomes "<last word of the full
  name> household", for example "Okafor household".
- **A box to tick**: "I understand this is a test environment: no real
  money moves, and the identity check is simulated." It is required, and
  stored as `test_terms_accepted_at`. It is a record that the person saw
  this before signing up.

No address and no email.

### The Adeyemi family: stays, unreachable

Its rows stay in the database. Nothing in the app can reach them after
step 11. Why keep them:

- The ledger was built so transactions and entries can never be deleted.
  Removing the family would mean switching off those guards, the very thing
  they exist to prevent.
- No customer, membership or access code will ever point at that household,
  so no sign-in can lead to it, and every read will be for the signed-in
  person's household only.
- `supabase/seed.sql` stays as history, but its header will say it is not
  needed for a new database. The ledger tests do not use it.

## B. Creating a household in one go

One function, `public.create_household`, written in plain SQL (PL/pgSQL
with no extensions). Only the server key may call it, set in the grants
file. It runs as a single save: if any part fails, nothing is kept.

What it is given:

- the typed details, already checked on the server: full name, phone, date
  of birth, role, NIN, BVN and household name
- the access code's fingerprint, its locked copy and the key version, all
  made on the server
- the visitor fingerprint
- the limits from section F, passed in so you can change them without a new
  migration and the tests can use small numbers

What it does, in order:

1. Checks the details again: the phone, NIN and BVN patterns, 18 or over in
   Lagos time, name length.
2. Takes a short database lock so two sign-ups cannot slip past the limits
   at the same moment. Then it checks the limits: sign-ups from this visitor
   in the last 24 hours, customers created today, and customers in total.
3. Creates the household, the customer, the membership (as owner), the five
   accounts (Hearth Bank as a hidden bank_source, Family Wallet, Rent,
   School fees, Groceries), the four account numbers and the access code.
4. Records the sign-up attempt, and clears attempt rows older than 7 days.
5. Returns the household id and customer id.

All balances start at ₦0.00 because there are no entries yet. The sign-up
screen then creates the first session (section D).

## C. The access code

**Format.** 16 characters from the Crockford base-32 alphabet, shown in four
groups: `K7QM-3XPD-9RTA-W2FH`.

- **Randomness:** 80 bits from the server's secure random generator. That is
  about 1.2 million million million million possibilities, so guessing is
  not realistic even with millions of tries.
- **Easy to read and type:** the alphabet leaves out I, L, O and U, so no
  character can be mistaken for another. Sign-in ignores capitals, spaces
  and hyphens, and reads O as 0 and I or L as 1.

**Finding the person at sign-in.** The server tidies the code into its 16
characters, and the database looks it up by its SHA-256 fingerprint. The
code itself is never compared or logged.

**Storage (decided): locked with a server key.**

- **How it is locked.** On the server, with AES-256-GCM, using a new secret,
  `ACCESS_CODE_ENCRYPTION_KEY`, kept only on the server, never in the
  database or Git.
- **Changing the key later.** Each locked code records which version of the
  key locked it (`key_version`). A later change can add a new key, use it
  for new codes, and re-lock old codes gradually.
- **What a database reader gets.** Someone who reads the database sees only
  scrambled text and fingerprints, and cannot sign in as anyone.
- **If the key is lost,** codes cannot be shown again, and people would need
  new codes (a "new code" feature would come in a later slice).

## D. Sessions

What I read in the bundled Next.js 16 docs (`node_modules/next/dist/docs/`):

- `cookies()` is async. Pages may read cookies, but setting or deleting one
  only works in a Server Function (server action) or a Route Handler.
- `middleware` has been renamed `proxy`. A proxy runs before every page,
  but the docs warn it should only do quick cookie checks, not database
  checks. Server actions are handled on the route they are used from, so a
  proxy matcher change can silently skip them. The docs say to check
  authorisation inside each server function rather than relying on the
  proxy.
- Layouts do not re-run on every navigation, so checks belong near the
  data. The docs recommend a server-only "data access layer" with a
  `verifySession()` wrapped in React's `cache()`, so it runs once per
  request.

The design (approved):

- **Recognising a browser.** At sign-up or sign-in, the server makes a
  random 32-byte token and puts it in a cookie named `familyfi_session`.
  The cookie is HttpOnly (page scripts cannot read it), Secure on the live
  site, SameSite=Lax, and Path=/. The database stores only the token's
  SHA-256 fingerprint, so a database copy cannot be used to sign in.
- **Checking a session.** `getSession()` lives in a new server-only file,
  `lib/session.ts`. It reads the cookie, takes the fingerprint and asks the
  database for an active session, returning the person and their household.
  A missing, unknown, ended or expired session means not signed in.
- **How long it lasts.** The session ends after 30 days without use, and
  after 180 days whatever happens. The cookie itself lasts 180 days. Each
  use moves the 30-day point forward, but the database is updated at most
  once an hour per session, so a page view does not always mean a write.
- **Signing out.** A "Sign out" button runs a server action. It marks the
  session row as ended, deletes the cookie and goes to /. A copied cookie is
  useless after that, because the database row says ended.
- **Every page and every server action checks the session itself.** Each
  /app page calls `requireSession()`, which sends a signed-out visitor to
  /sign-in. Each money action checks the session too.
- **The proxy.** Not used in this slice. If added later, it would only send
  visitors with no cookie at all to /sign-in, as a speed-up.
- **Order of checks in a money action:** the write switch first (it needs no
  database), then the session, then the checks that exist today.

## E. Isolation between households

**Where the fixed household is used today, and how each is replaced:**

| Place | Today | After Slice 5 |
|---|---|---|
| `lib/ledger.ts` line 19 | `DEMO_HOUSEHOLD_ID` constant | Removed |
| `lib/ledger.ts` line 78, `getHouseholdBalances` | Filters by the constant | Takes the household id from the session |
| `lib/ledger.ts` lines 186 and 209, `getAccountStatement` | Both reads filter by the constant | Takes the session's household id; the account must belong to it, or the page shows "not found" |
| `lib/moves.ts` line 27 | Its own copy of the constant | Removed |
| `lib/moves.ts` line 86, reading the accounts | Filters by the constant | Uses the session's household |
| `lib/moves.ts` line 109, calling post_transaction | Sends the constant | Sends the session's household |
| `app/app/page.tsx` line 87 | "The Adeyemi Family" written into the page | The household's name from the database |
| `supabase/seed.sql` | Creates the Adeyemi family | Unchanged; a note says new databases do not need it |

**The rule:** the household id is only ever taken from `getSession()` on
the server. No page reads it from the address and no form sends it. The
functions that read or move money will take the session's household as an
input, so it is impossible to call them without choosing one deliberately.
The database adds a second wall: `post_transaction` already refuses entries
on accounts from another household.

**Tests that prove it:**

- **Without a database (stand-ins):**
  - With person A signed in, a statement for one of household B's accounts
    gives "not found".
  - Moving money from or to one of B's accounts gives "unknown", and nothing
    is posted.
  - Add money always uses A's own bank account and wallet.
  - A form that carries a household id has that field ignored.
  - Every money action without a session sends the visitor to sign-in and
    makes no database call.
- **Against the database** (a new self-checking test file, like
  `ledger_tests.sql`, ending in a deliberate error that discards
  everything):
  - Two households are created with create_household. Reading A's balances
    and statements never shows a row of B's.
  - post_transaction refuses A's household with B's accounts.
  - A session of A's never returns B's household.
- **By hand:** two browsers and two sign-ups. In browser A, paste one of B's
  statement addresses: expect "not found". In the browser's developer
  tools, change the Move money "To" value to one of B's account ids and
  send: expect the refusal sentence, and no change to B's balances.

## F. Abuse of the public forms (approved)

| Rule | Number | Reason |
|---|---|---|
| Sign-up switch | `SIGNUPS_ENABLED`, on only when exactly `true`, separate from `WRITES_ENABLED` | Same strict rule as the write switch. Off on the live site until you say |
| Sign-ups per visitor | 3 in 24 hours | A couple testing on one phone or Wi-Fi needs 2; one spare for a mistake. Stops a script making hundreds |
| New customers per day, everyone together | 50 | A daily brake on a flood that rotates internet addresses. Each sign-up creates exactly one customer, so this is the same as new households per day |
| Total customers | 300 | Counts customers, not households, so the retired Adeyemi household (which has none) is not counted. Keeps the free database small and any clean-up bounded. Easy to raise later |
| Wrong access codes per visitor | 5 in 15 minutes, 20 in 24 hours | Guessing is already hopeless with 80-bit codes, so this limits noise and database load. Typing mistakes rarely exceed 5 |
| While a visitor is over the wrong-code limit | Even a correct code is refused until the window passes | Otherwise the limit would not slow anyone down |

**How a visitor is recognised.** See the security requirements below. The
address is stored only as a fingerprint made with a second new server
secret, `VISITOR_HASH_KEY`. An internet address counts as personal data, so
the raw address is never stored.

**Known weakness.** Many people in Nigeria share one mobile network address,
so one busy address could block others, and a VPN gets round a per-visitor
limit. That is why the daily and total caps exist as well.

The limits are checked inside create_household and the sign-in function,
under a database lock, so two requests at the same instant cannot both
squeeze past.

## Security requirements (firm)

1. **The visitor's address comes from a header Vercel sets itself.**
   - The app reads the first (leftmost) entry of `x-forwarded-for`.
   - Vercel's request-headers documentation describes it as the client's
     public IP, and says Vercel overwrites it rather than forwarding outside
     values, to prevent IP spoofing:
     https://vercel.com/docs/headers/request-headers. Vercel's guide on
     reverse proxies says the same:
     https://vercel.com/docs/security/reverse-proxy.
   - The app never uses `x-real-ip` or any other header for this, and never
     anything from a form or the address bar.
   - On your computer the header is missing, so all local requests count as
     one visitor, "local".
   - If another proxy or CDN is ever put in front of Vercel, this header
     would hold that proxy's address instead, so the per-visitor limit must
     be revisited then.
2. **The access code, NIN and BVN never appear** in an address (URL), a log
   line, an error message, a cached page, or in the state a form action
   returns.
   - All these forms send by POST, through server actions.
   - The sign-up form keeps the visitor's typed values in the browser
     itself, so the action never has to send them back. It returns only an
     outcome and field-problem codes.
   - Log lines carry only codes and the database's code and message, never
     these values, the session token or the phone.
   - The access code reaches the browser only on `/welcome` and
     `/app/profile`, read fresh from the database for the signed-in person.
     Both are sent as no-store, and the live checks confirm the
     `Cache-Control` header says `no-store`.
3. **A missing secret fails closed.**
   - If `ACCESS_CODE_ENCRYPTION_KEY` or `VISITOR_HASH_KEY` is missing, empty
     or the wrong length, sign-up shows "Sign-up is unavailable right now.
     Please try again later." and sign-in shows "Sign-in is unavailable right
     now. Please try again later."
   - Nothing is created, there is no crash, and no detail is shown. The
     server log names the missing setting, never its value.
   - The profile shows "Your access code cannot be shown right now." in that
     case.
4. **`key_version` is stored with every locked access code**, so the key can
   be changed later (section C).
5. **Old attempt rows are cleared** by `clean_up_auth_attempts`, as described
   in section A.

## G. Screens

All screens are mobile first, in the same 480 px column, with the same
colours and 52 px tap targets.

- **`/`** stays a static page. It shows the FamilyFi name, one line saying
  this is a test environment where no real money moves, and two buttons:
  "Create your household" and "Sign in". It does not read the session, so
  it stays fast and cacheable. (This changes in step 11.)
- **`/sign-up`**
  - When `SIGNUPS_ENABLED` is off, it shows "New sign-ups are paused right
    now." and no form.
  - Otherwise: full name, phone, date of birth, Husband or Wife, NIN, BVN,
    household name (optional), and the test-terms box.
  - A short note: "This is a test environment. Please use a made-up name and
    date of birth. Phone, NIN and BVN must be test numbers: 11 digits
    starting with 000. A NIN or BVN ending in 99 shows a failed check."
  - A "Fill in test details" button (a small browser-side helper) fills
    every field with made-up test values: a name from a list, a test phone
    number, an adult date of birth, NIN and BVN starting with 000. It never
    fills a NIN or BVN ending in 99.
  - The button reads "Check my details", then "Checking your identity…"
    while sending.
- **The simulated verification step.** The form uses React's
  `useActionState`. The typed values stay in the browser.
  - A field problem is shown beside that field.
  - A NIN or BVN ending in 99 shows: "We could not verify these details.
    This is a simulated check." Nothing is created.
  - A pass creates the household, signs the person in and opens `/welcome`.
- **`/welcome`**
  - "Identity check passed (simulated)."
  - The access code in large letters, with a "Copy" button.
  - "Write this down. You will need it to sign in on another phone. You can
    see it again on your profile."
  - A button: "Go to my household".
  - Without a session, it sends the visitor to `/sign-up`.
- **`/sign-in`**
  - One box, "Access code", and a "Sign in" button.
  - A wrong code: "That access code did not work. Check it and try again."
  - Over the limit: "Too many attempts. Please wait 15 minutes and try
    again."
- **`/app/profile`**
  - Full name, role, test phone and household name.
  - NIN and BVN with all but the last 3 digits hidden.
  - "Identity: verified (simulated)" with its date.
  - The access code, always visible.
  - Each account's name and its test account number.
  - A "Sign out" button.
- **`/app` header**: the household's name and a "Profile" link.
- **Signed-out visitor at `/app` or any page under it**: sent to `/sign-in`
  (from step 11).

## H. Money rules

- Add money, Move money and the statement keep their current rules, now for
  the signed-in person's household.
- The ₦2,000,000 ceiling now applies to each household.
- `WRITES_ENABLED` stays exactly as it is. `SIGNUPS_ENABLED` is separate.
- On the live site both stay off until you say otherwise.
- New secrets: `ACCESS_CODE_ENCRYPTION_KEY` and `VISITOR_HASH_KEY`. You
  generate each value on your own computer with a one-line command I give
  you, and paste it into `.env.local` and into Vercel yourself. I never see
  the values.

## I. Steps

Every step ends with a stop for your go-ahead.

- **Steps 1 to 10** may be pushed as they finish. None of them changes what
  a live visitor sees on the existing pages; each says what changes.
- **Step 11** is not pushed until you say you are ready to switch sign-up on
  for the live site.
- **Both secrets must be on Vercel before step 8 is pushed**, because step 8
  is the first push with session and sign-in code.

1. **Update CLAUDE.md and README.md** to match the decisions above. Commit.
   *After a push:* the live site is unchanged; the README on GitHub reads
   differently.
2. **Migration 1** (tables). I write it; you run it in Supabase: SQL Editor,
   New query, paste the file, Run, expect "Success. No rows returned".
   *After a push:* unchanged. The new tables are empty and unused.
3. **Migrations 2, 3 and 4** (create_household, sign-in, sessions and
   clean-up, grants). I write them; you run them in that order, the same
   way. *After a push:* unchanged.
4. **Database tests.** I write `supabase/tests/households_tests.sql`; you
   run it and paste back the report line. Expect "ALL PASSED". It leaves no
   trace. *After a push:* unchanged.
5. **Pure helpers and their tests:**
   - access code format and tidying
   - NUBAN check digit, including both worked examples
   - the phone, NIN and BVN test patterns, and the 99 outcome
   - age in Lagos time
   - the limit decisions

   Checked with `npm test`. *After a push:* unchanged.
6. **Secrets and the sign-up switch.**
   - You generate the two secrets and add them to `.env.local`. I give you
     the exact command and never see the values.
   - I add the `SIGNUPS_ENABLED` helper, the encryption code and the
     fail-closed checks, with tests.

   *After a push:* unchanged.
7. **Make the readers and the write path take a household id.** For now the
   /app pages pass the Adeyemi id from one temporary place, so the live site
   behaves exactly as today. Isolation tests with stand-ins. *After a push:*
   unchanged.
8. **Session layer, sign-up screens and `/welcome`**, behind
   `SIGNUPS_ENABLED`. Sign-up creates the first session. You test locally
   with the switch on. *Before pushing:* both secrets on Vercel. *After a
   push:*
   - `/sign-up` exists and says "New sign-ups are paused right now."
   - `/welcome` sends visitors to `/sign-up`.
   - Nothing links to either; every existing page is unchanged.
9. **Sign-in and sign out.** Tested locally by signing out and back in with
   the code shown on `/welcome`. *After a push:*
   - `/sign-in` exists; nothing links to it.
   - With no customers on the live database, any code a visitor tries gets
     "That access code did not work", and is counted under the wrong-code
     limits.
   - Existing pages are unchanged.
10. **Profile screen.** *After a push:* `/app/profile` sends anyone not
    signed in to `/sign-in`. Nobody can sign in on the live site yet, so
    nobody sees it. Existing pages are unchanged.
11. **Put /app behind sign-in and retire the Adeyemi family.**
    - Every page and action checks the session.
    - The temporary id from step 7 is removed.
    - The heading comes from the household.
    - `/` gets its two buttons.

    This is the first step that changes what a visitor sees: `/` shows the
    new buttons, and `/app` sends them to `/sign-in`. **Not pushed until you
    say you are ready to switch sign-up on for the live site.**
12. **Your hand check, locally:**
    - two browsers, two households
    - the isolation attacks in section E
    - signing out and back in
    - clearing cookies and signing back in
    - the phone layout
13. **Build, all tests, leak checks, commit.** Not pushed.
14. **Going live, with your go-ahead:**
    - add the secrets to Vercel if they are not already there
    - push step 11
    - switch on `SIGNUPS_ENABLED` on Vercel, and `WRITES_ENABLED` only if you
      say so
    - live checks: sign up with test details, see the access code, sign out
      and back in, the isolation checks, the `Cache-Control` headers, and the
      leak check

## J. Tests

**Without a database (`npm test`):**

- Access codes: format, randomness source, tidying, fingerprint.
- Locking and unlocking a code, including that a tampered copy and a wrong
  key version are refused.
- A missing or short secret fails closed.
- Session token and fingerprint.
- NUBAN check digit: the CBN example in its 3-digit form (011 and 000001457
  give 9) and its 6-digit form (000011 and 000001457 give 9), and FamilyFi's
  000000.
- The phone, NIN and BVN test patterns, and the 99 outcome.
- Age 18 on the birthday itself, the day before, and 29 February birthdays,
  all in Lagos time.
- The visitor fingerprint: the leftmost `x-forwarded-for` entry is used, and
  a missing header gives "local".
- The limit decisions.
- Redirects and notices for the new screens.
- The isolation tests in section E.
- Every action refuses without a session.
- No action's returned state ever contains the access code, NIN or BVN.

**Against a database (`supabase/tests/households_tests.sql`, run by you):**

- create_household makes exactly one customer, one household, one
  membership, five accounts, four account numbers and one access code, all
  balances ₦0.00.
- Account numbers are unique, 10 digits, with valid check digits; the bank
  account has none.
- Refusals: a phone, NIN or BVN not in the test pattern, under 18, a second
  owner, the limits, with the 300 cap counting customers only.
- All or nothing: a forced failure partway leaves no rows behind.
- Sign-in: the right code starts a session; a wrong code is counted; over
  the limit even a right code is refused.
- Sessions: an ended or expired session returns nothing.
- Old attempt rows are cleared.
- Isolation between two households, as in section E.

**Only a person can check:**

- How the screens look on a phone, and the "Fill in test details" button.
- The cookie's settings in the browser's developer tools: HttpOnly, Secure
  on the live site, SameSite=Lax.
- Signing out and back in, and clearing the browser and signing back in.
- The two-browser isolation attacks.
- The live site before and after step 14.

## K. Risks

- **Names and dates of birth are free text.** People may type real ones
  despite the note. The phone, NIN and BVN cannot be real, because the table
  refuses anything outside the test pattern.
- **The access code is the only key.** Anyone who sees it, over a shoulder
  or in a screenshot, gets in. There is no second check.
- **The visitor limits are rough.** Shared mobile addresses and VPNs, as
  explained in section F.
- **Losing the encryption key** means codes cannot be shown again.
- **Every /app page now reads the session from the database**, adding a
  little time to each visit.
- **Abuse at scale.** 300 customers could each hold up to ₦2,000,000 of
  test money, and every sign-up adds permanent ledger rows.
- **Account numbers might match real ones**, as explained in section A.
- **Wrong-code rows on the live site.** After step 9 is pushed, visitors who
  find `/sign-in` can add wrong-code rows to the live database. They are
  bounded by the per-visitor limits and cleared after 7 days.
- **The partner slice** will need its own rules for joining a household.
  This slice only prepares the membership table.

**Open questions:** none.
