# Slice 6 plan: a partner joins the household

Status: approved, with the answers recorded in section L. Building step
by step; nothing is pushed until the owner says so.

## Goal

A second person, the partner, joins an existing household with a one-time
invite code, so FamilyFi works as a couple: both people see and move the
same household's money, each with their own access code and session.

## Decisions already made (not reopened here)

- Joining is by a one-time invite code that the owner creates: 16
  characters, the same Crockford base-32 alphabet and four-group layout as
  the access code (for example 4HQX-7MRT-2KPD-9WVA). Valid for 48 hours,
  works once.
- The partner opens a Join page, types the invite code and their own test
  details, and passes the same simulated identity check as sign-up, with
  the same rules (test numbers only; a NIN or BVN ending in 99 is not
  verified). They get their own access code and their own session.
- The partner shares the household's wallet, pots and account numbers.
  Nothing new is made for them.
- The partner has the same rights as the owner for adding and moving money
  and reading statements. Only the owner can create an invite.
- At most two members per household: one owner, one partner. One household
  per customer stays.
- SIGNUPS_ENABLED also gates joining.

## Decisions made after the first draft

- Roles: any role is allowed. The partner may choose the same role as the
  owner. There is no role rule anywhere.
- Banner: "You're the only one here yet. Invite your partner from
  Household." (a code, not a link).
- Invite codes are locked with the existing ACCESS_CODE_ENCRYPTION_KEY.
  No new secret. The owner may see an unused code again.
- Partner approvals and caps are a later slice. In this slice the partner
  has the same money rights as the owner.
- Ledger: option 2, a nullable `created_by` on transactions, as its own
  late step (step 9).
- The invite lives on a new `/app/household` screen.
- Limits as proposed: wrong invite codes 5 per 15 minutes and 20 per 24
  hours per visitor; 10 invites per household per day; joins share the
  sign-up limits (3 per visitor per 24 hours, 50 per day, 300 customers in
  total).
- Every proposed visitor sentence in section J is approved.

## What exists today that this slice builds on

- `customers`, `household_members` (member_role `owner` or `partner`, one
  household per customer, one owner per household), `access_codes`,
  `sessions`, `auth_attempts` (kinds `sign_up` and `sign_in_failed` only).
- `create_household` (one all-or-nothing save, refusals raised as
  `code: sentence`), `sign_in_with_code` (outcomes returned as a status,
  so the row counting a wrong code is kept), `get_session`, `get_profile`.
- In the app: `checkIdentity` and the field sentences in `lib/identity.ts`,
  the sentences in `lib/auth-limits.ts`, the access code helpers and AES-GCM
  locking, the session cookie, `requireSession()`, the core and wrapper
  pattern, and `/welcome`, which already works for any signed-in person.

---

## A. Database: the invites table

### New table `household_invites`

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| household_id | uuid | references households, not null |
| created_by | uuid | references customers, not null; must be the household's owner |
| code_hash | text | SHA-256 fingerprint, 64 lowercase hex, unique |
| code_encrypted | text, nullable | the locked copy (see below); set to null once the invite is used, voided or past its time |
| key_version | integer, nullable | null exactly when code_encrypted is null |
| created_at | timestamptz | default now() |
| expires_at | timestamptz | created_at + 48 hours, set by the database |
| used_at | timestamptz, nullable | when the partner joined with it |
| used_by | uuid, nullable | references customers: the partner it made |
| voided_at | timestamptz, nullable | when a newer invite replaced it |

Rules, as constraints and triggers in the same style as Slice 5:

- **One active invite per household**: a unique partial index on
  `household_id` where `used_at is null and voided_at is null`. "Active"
  also needs `expires_at > now()`, which an index cannot test, so the
  functions treat an expired row as inactive and void it when they next
  touch the household.
- `used_at` and `voided_at` can never both be set; once either is set it
  never changes; nothing else in a row can change; rows are never deleted
  or truncated (kept as a record).
- `used_by` is set exactly when `used_at` is set.

### How the code is stored

- **For checking:** the fingerprint only, as for access codes.
- **Seeing an unused code again (recommended: yes).** The owner may close
  the page before sending the code. Store a locked copy with the same
  AES-256-GCM locking as the access code, so the household screen can show
  the active code again. The copy is wiped (set to null) the moment the
  invite is used, voided or found expired, so a used code can never be
  shown or recovered.
- **Which key (decided):** the existing `ACCESS_CODE_ENCRYPTION_KEY` and
  its key versions, so no new secret is needed. Each locking uses a fresh
  random IV, so sharing the key is safe.

### Other database changes

- `auth_attempts.kind` allows a third value, `invite_failed`, for wrong
  invite codes (the constraint is replaced; existing rows are unaffected).
- **At most two members**: a new unique partial index on
  `household_members (household_id) where member_role = 'partner'`. With
  the existing one-owner index and member_role limited to owner or
  partner, the database itself can never hold a third member.

## B. Database functions

All are `security definer`, `set search_path = ''`, callable by
`service_role` only (a separate grants file, Supabase only, as in
Slice 5). The person always comes in as a customer id the server took from
the session; no function takes a household id.

### `create_invite(p_customer_id, p_code_hash, p_code_encrypted, p_key_version)`

One save:
1. Checks the values the server made.
2. Finds the person's membership; refuses unless they are the **owner**.
3. Takes a household lock, then refuses if the household already has a
   partner.
4. Voids the household's current invite, if any (wipes its locked copy).
5. Inserts the new invite with `expires_at = now() + 48 hours`.

Gives back `{"expires_at": "..."}`. Refusals, raised as `code: sentence`
like create_household:

| Code | When |
|---|---|
| `not_owner` | the person is a partner, or has no household |
| `household_full` | a partner has already joined |
| `code_taken` | the fingerprint is already used by another invite (practically never; the app makes a new code and tries once more) |
| `bad_request` | a server-made value is not in the expected form |

### `get_active_invite(p_customer_id)`

Read only, except that it voids an expired invite it finds. For the owner:
`{"code_encrypted", "key_version", "expires_at"}` of the active invite, or
null if there is none. For a partner or anyone else: always null.

### `join_household(...)`

Arguments, in order: `p_invite_hash`; the typed details `p_full_name,
p_phone, p_date_of_birth, p_role, p_nin, p_bvn, p_test_terms_accepted`
(no household name); the new person's access code `p_code_hash,
p_code_encrypted, p_key_version`; `p_visitor_hash`; the limits
`p_max_signups_per_visitor, p_max_customers_per_day, p_max_customers_total,
p_max_wrong_invites_per_15_minutes, p_max_wrong_invites_per_24_hours`; the
first session `p_token_hash, p_idle_days, p_absolute_days`. Twenty in all.

One save, in this order:
1. Check the server-made values and the limits (`bad_request` if wrong).
2. Check the typed details again, exactly as create_household does (a
   second wall behind the app): `bad_details`, `not_verified`, `under_18`.
3. Take a per-visitor lock. Clear counter rows older than 7 days.
4. **Wrong-invite limit first**, before the code is looked at, so a
   visitor over the limit learns nothing: `too_many_attempts`.
5. Find the invite by fingerprint, locked for update. If there is none, or
   it is used, voided or past its time: insert an `invite_failed` row and
   return `invite_not_valid`. All four cases look identical.
6. Take the household lock and the sign-up lock (the same lock
   create_household takes, so the totals cannot race). Check the sign-up
   limits (see C): `limit_visitor`, `limit_daily`, `limit_total`.
7. Refuse `household_full` if a partner already exists (should not happen
   while the invite is unused, but the race is closed here). There is no
   role rule: the partner may choose either role.
8. `code_taken` if the access code fingerprint is in use.
9. Create the customer, the membership as `partner`, the access code, one
    `sign_up` row in auth_attempts and the first session; mark the invite
    used (`used_at`, `used_by`) and wipe its locked copy.

**Why outcomes are returned, not raised:** as with sign_in_with_code, a
raised error throws away the whole save, including the row that counts a
wrong invite code. So every visitor outcome is returned as a status:

- `{"status": "joined", "customer_id", "household_id", "session_id"}`
- `{"status": "<refusal code>"}` for every refusal from step 4 onwards

Only `bad_request` and the step 2 checks are raised (nothing needs keeping
at that point, and the app has already made those checks).

### `get_household_members(p_customer_id)`

Read only. For any member: the household's members as
`[{"full_name", "member_role", "is_you"}]`, owner first. Names and member
roles only: never phone, NIN, BVN, date of birth, access code or any id.
Null if the person has no household.

`get_session` and `get_profile` stay unchanged: get_profile already gives
each person only their own details, and the members list is separate.

## C. How the existing limits apply to joining

Recommendation: a join is a sign-up for counting purposes, because it
creates a customer.

- **Per visitor:** a join adds a `sign_up` row, so sign-ups and joins
  share the limit of 3 per visitor in 24 hours (1000 for the "unknown"
  bucket in development only, as now).
- **Per day:** 50 customers a day, counting partners.
- **Total:** 300 customers, counting partners. So at most 300 people, in
  150 to 300 households.
- **Wrong invite codes:** a separate counter (`invite_failed`), so a
  person who mistypes an access code is not locked out of joining. Proposed
  numbers: **5 per 15 minutes and 20 per 24 hours per visitor**, the same
  as wrong access codes. With 80-bit codes, at most one active invite per
  household and these limits, guessing is not practical.
- **Invites created:** proposed limit of **10 per household in 24 hours**,
  so an owner cannot fill the table. Refusal `limit_invites`.

## D. Screens

All mobile first, 480 px column, 52 px tap targets, built fresh for every
visit and never stored.

### `/app/household` (new): members and the invite

Recommended over adding it to Profile: Profile is about the person; this
screen is about the household. The `/app` header gets a "Household" link
beside "Profile".

- **Members**: each member's name, with "Owner" or "Partner", and "(you)"
  beside your own name.
- **Invite** (shown only to the owner, and only while there is no
  partner): a "Create an invite code" button. Once made: the code in large
  letters in four groups with the existing Copy button, the time it stops
  working (a Lagos date and time), a note, and "Create a new code".
- The partner sees Members only. The invite section is not rendered for
  them, and the database refuses them anyway (see G).

### `/join` (new): the Join page

- Paused (SIGNUPS_ENABLED off): only the FamilyFi name, the paused
  sentence and "Back to FamilyFi".
- Otherwise: "Invite code" box (same settings as the sign-in box), then the
  same fields as sign-up except household name: full name, phone, date of
  birth, Husband or Wife, NIN, BVN, the test-terms box. The same note about
  test numbers, the same "Fill in test details" button (it does not fill
  the invite code or the terms box), the same field sentences, and one
  general sentence above the button.
- Button: "Join household", and "Checking your identity..." while sending.
- On success: the session cookie is set and the partner goes to the
  existing `/welcome`, which shows their own access code. Nothing new is
  needed there.
- The front page and `/sign-in` get a small link: "I have an invite code"
  to `/join`.

### `/app` banner for an owner on their own

Shown to the owner while there is no partner, with a link to
`/app/household`: "You're the only one here yet. Invite your partner from
Household." (approved; CLAUDE.md now says a code, not a link).

## E. Members on screen

Covered by `/app/household` above. The other member's personal numbers
never reach the app: get_household_members does not return them, and
get_profile returns only your own.

## F. The ledger: recording which member made a transaction

Today `transactions` has household, description, idempotency key and
time. Nothing says who pressed the button. With two people sharing money,
that becomes worth knowing, but it changes the ledger, so the options:

| Option | What changes | Cost | Benefit |
|---|---|---|---|
| 1. No change now | nothing | none | the slice stays small; statements cannot say who moved money; a later change only covers transactions from then on |
| 2. A nullable column on `transactions` | `created_by uuid null references customers`; post_transaction gets a fifth argument and checks that person is a member of the same household; the app passes the session's customer id | one migration that alters a ledger table (adding a column does not touch existing rows, and the append-only triggers still apply); post_transaction is replaced, so its grants are redone; every caller and its tests change | one row says everything; enforced in the same save; statements can show "by Ada"; old rows (the retired family) stay null |
| 3. A separate audit table | `transaction_authors (transaction_id, customer_id)` written by post_transaction in the same save | the ledger tables themselves are untouched, but post_transaction still changes, and reading needs a join; two places to keep in step | leaves the core ledger table exactly as it is |

**Recommendation: option 2**, as its own step near the end of the slice
(step 9 in section I), so it can be dropped without touching the rest. It
is the simplest correct record, the database enforces it, and attribution
is what a shared account is expected to have. Null is allowed only for
rows from before the change; post_transaction refuses a new transaction
with no member.

## G. Session and privacy

- The household id still comes only from the session: get_session finds
  it from the person's own membership, which now may be `partner`. No
  page, form or address ever names a household. Nothing in Slice 5's
  session code changes.
- The partner's session never shows the owner's personal details:
  get_profile is per person, and get_household_members gives names and
  member roles only.
- **A partner cannot create an invite, enforced by the database**:
  create_invite refuses `not_owner` from the membership row, whatever the
  app or a hand-made request sends. get_active_invite gives a partner null.
  The screen hiding the button is only the polite layer.
- The money actions are unchanged: they already take the household from
  the session, so the partner can add and move money exactly like the
  owner, within the same ceiling of ₦2,000,000 per household.

## H. Tests

### Against the real database (a self-checking file you run, ending in a deliberate error so everything is discarded, like ledger_tests.sql)

1. create_household, then create_invite by the owner: one active invite,
   expiring 48 hours after it was made.
2. A second create_invite voids the first; the first's locked copy is
   wiped; joining with the first gives `invite_not_valid`.
3. join_household with the active invite creates exactly one customer,
   one `partner` membership, one access code, one session, one `sign_up`
   row; no new account or account number; the invite is used and wiped.
4. The same invite a second time: `invite_not_valid`, and one
   `invite_failed` row is kept.
5. An unknown invite fingerprint: `invite_not_valid`, counted.
6. After 5 wrong invites in 15 minutes: `too_many_attempts`, even with
   the right code, and not counted again.
7. An expired invite (made with its time moved back inside the test):
   `invite_not_valid`.
8. A partner calling create_invite: `not_owner`. get_active_invite for the
   partner: null.
9. A third member, by any route (a second invite, a direct insert as
   partner): refused (`household_full`, then the unique index).
10. join_household with a NIN ending 99: `not_verified`, nothing created.
11. The limits: per visitor, per day and total count joins.
12. get_session for the partner gives the owner's household id.
    get_household_members gives two rows with names and member roles only.
13. post_transaction (if option 2): a transaction by the partner records
    the partner; one naming a customer from another household is refused.
14. anon and authenticated cannot run any of the new functions (the
    grants file).

### Stand-ins for the app (node --test)

- Join core: early exits make no database call (paused, missing secrets,
  field problems, 99); only fingerprints and the locked copy are sent;
  the returned state never holds the invite code, the access code, the
  token, the NIN or the BVN; every status maps to its sentence; a form
  field naming a household is ignored.
- Invite core: create, show again, a decryption failure gives the unknown
  sentence; the partner path makes no create call.
- Answer shape checks for every new database call, including an answer
  holding a full NIN being refused.
- Members display: no personal numbers ever.

### Source checks

- No console calls, no forbidden words, no em dashes in new files.
- `/join` and `/app/household` read no searchParams or params to choose a
  person or household.
- Every page under app/app/ still calls requireSession first.

### By hand (Tobi, two browsers)

1. Browser A: sign up; open Household; create an invite; copy it.
2. Browser B: open /join; paste; fill in test details (either role);
   join; see your own access code on /welcome; go to the household.
3. Both browsers show the same balances. Add money in B; A sees it.
4. B opens Household: two members, no invite section.
5. A: the invite section is gone (household full).
6. B tries the used invite again in a private window: the refusal sentence.
7. Profile in each browser shows only that person's own details.
8. Sign out and back in with each access code.

## I. Build order

Commit rule for every step: commit only after `npm test` and then `npm run
build` both pass in the same session. Nothing is pushed until you say so.

1. **This plan.** Commit.
2. **Migration 1 (tables).** `household_invites`, the `invite_failed`
   kind, the one-partner index. *Run by Tobi in Supabase.*
3. **Migration 2 (functions) and its grants file.** create_invite,
   get_active_invite, join_household, get_household_members. *Run by
   Tobi.* Then the real-database test file. *Run by Tobi.*
4. **App plumbing.** Invite code helpers (reusing the access code
   generator, tidying and locking), the new database calls with shape
   checks, the invite and join cores, new sentences in a new lib file.
   Stand-in tests. No screens.
5. **`/app/household`.** Members, and the owner's invite section. The
   "Household" link in the /app header.
6. **`/join`** and its action, reusing /welcome.
7. **Links and banner.** "I have an invite code" on / and /sign-in; the
   owner-alone banner on /app.
8. **Hand checks** with two browsers, locally.
9. **Ledger attribution (if option 2 is chosen).** Migration 3 (*run by
   Tobi*), the post_transaction change and its grants, the app passing the
   session's customer id, statements showing the member's first name.
10. **Final checks** (the same as Slice 5 step 13), then push when you say,
    with SIGNUPS_ENABLED still off until you decide.

## J. New visitor sentences (for approval; none is used until approved)

Join page:

- Heading: "Join a household"
- Label: "Invite code"
- Note: "Ask your partner for their invite code. This is a test
  environment. Use test numbers only: 11 digits starting with 000. A number
  ending in 99 shows a failed check."
- Button: "Join household"; while sending, the existing "Checking your
  identity..."
- Paused: the existing "New sign-ups are paused right now."
- `invite_not_valid` (not found, used, voided or expired, all the same):
  "That invite code did not work. Check it with your partner and try
  again."
- `household_full`: the same sentence as `invite_not_valid`.
- `too_many_attempts`: the existing "Too many attempts. Please wait 15
  minutes and try again."
- `bad_details`, `not_verified`, `under_18`, `limit_*`, unknown: the
  existing sign-up sentences.
- Link on / and /sign-in: "I have an invite code"

Household screen:

- Link in the /app header: "Household"
- Headings: "Members", "Invite your partner"
- Member labels: "Owner", "Partner", "(you)"
- Button: "Create an invite code"; while sending, "Creating..."
- With an active code: "Send this code to your partner. It works once, for
  48 hours." and "Stops working: <date and time>". The date and time are
  always Lagos time, never the server's clock: the database gives
  `expires_at` as a moment, and the app formats it with
  `Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day:
  "numeric", month: "long", year: "numeric", hour: "2-digit", minute:
  "2-digit", hourCycle: "h23" })`, for example "Stops working: 29 November
  2026, 14:05". A 24-hour clock, so there is no am or pm to misread. A
  test pins the result for a moment near midnight in Lagos.
- Button: "Create a new code", with the note "A new code stops the old one
  working."
- `not_owner`: "Only the person who created the household can invite a
  partner."
- `household_full`: "Your partner has joined. Your household is full."
- `limit_invites`: "You have made too many invite codes today. Please try
  again tomorrow."
- If the code cannot be shown: the existing unknown sentence.

/app banner (owner on their own, approved):

- "You're the only one here yet. Invite your partner from Household."

## K. Risks and what must change

Existing things this slice changes:

- `auth_attempts_kind_allowed` (one more kind) and a new index on
  `household_members`: Slice 5 tables, changed by a new migration only.
- `lib/auth-limits.ts` gains no lines; the new sentences go in a new file,
  so earlier files stay as they are.
- `/app` header (one more link), and / and /sign-in (one more link each).
- If option 2: `transactions`, `post_transaction`, `lib/moves*.ts` and
  their tests.
- CLAUDE.md: approvals and caps moved to a later slice, and the banner
  says a code, not a link (done in step 2).

Risks:

- **Two people moving money at once.** The overdraft check already locks
  each wallet and pot it touches (it was designed for two family members
  moving money at the same instant), so two moves cannot overdraw a pot. The
  idempotency keys are per form, so the two people never collide.
- **No way to leave or remove a partner.** customers and memberships
  cannot be deleted. A couple that is set up wrongly stays that way. Fine
  for a test environment; noted for later.
- **Invite codes in chat apps.** The code is sent outside FamilyFi. The
  48-hour limit, single use, voiding and the wrong-code limits keep that
  safe enough for test money.
- **The same key for two kinds of locked copy** (decided).
  Safe with random IVs; a key change re-locks both.
- **Expired invites stay as rows**, wiped of their locked copy. A later
  clean-up can remove old rows if needed.
- **Totals.** Partners count towards the 300, so the cap is people, not
  households.

## L. Answers to the questions (decided)

1. **Roles:** any role is allowed; the partner may choose the same role as
   the owner. No role rule, and no role sentence.
2. **Banner:** "You're the only one here yet. Invite your partner from
   Household."
3. **Key:** the existing ACCESS_CODE_ENCRYPTION_KEY. The owner may see an
   unused code again.
4. **Approvals and caps:** a later slice. Here the partner has the same
   money rights as the owner.
5. **Ledger:** option 2, as step 9.
6. **Where the invite lives:** the new `/app/household` screen.
7. **Limits:** approved as proposed in section C.
