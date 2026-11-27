// Tests for the household screen's choices and its create action, plus
// source checks on /app/household and the /app banner.
//
// Run with:  npm test
//
// Stand-ins replace the session, the switch, the secrets and the database.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { CreateInviteArgs, CreateInviteResult, HouseholdMember } from "./auth-db-core.ts";
import type { CreateInviteDeps, ReadMembersOutcome } from "./household-core.ts";
import {
  HOUSEHOLD_ERROR_CODES,
  householdErrorSentence,
  householdView,
  pathAfterCreateInvite,
  readHouseholdError,
  runCreateInviteAction,
  showLoneOwnerBanner,
} from "./household-screen.ts";
import { inviteCodeFingerprint } from "./invite-code.ts";
import type { SessionPerson } from "./session-core.ts";

const KEY = randomBytes(32);
const CODE = "4HQX-7MRT-2KPD-9WVA";

const OWNER: SessionPerson = {
  customerId: "c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b",
  householdId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  householdName: "Okafor household",
  fullName: "Ada Okafor",
  role: "wife",
};
const PARTNER: SessionPerson = { ...OWNER, customerId: "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a", fullName: "Tunde Okafor", role: "wife" };

// A stand-in database that knows who the owner is, and records every
// invite it really creates.
function database() {
  const calls: CreateInviteArgs[] = [];
  const created: CreateInviteArgs[] = [];
  const createInvite = async (args: CreateInviteArgs): Promise<CreateInviteResult> => {
    calls.push(args);
    if (args.customerId !== OWNER.customerId) {
      return { ok: false, code: "not_owner" };
    }
    created.push(args);
    return { ok: true, inviteId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e", expiresAt: "2026-11-29T13:05:00+00:00" };
  };
  return { calls, created, createInvite };
}

function deps(db: ReturnType<typeof database>, changes: Partial<CreateInviteDeps> = {}): CreateInviteDeps {
  return {
    getSession: async () => OWNER,
    signupsEnabled: () => true,
    accessCodeKeys: () => new Map([[1, KEY]]),
    createInvite: db.createInvite,
    generateInviteCode: () => CODE,
    ...changes,
  };
}

describe("the create action", () => {
  it("no session: /sign-in, and no database call", async () => {
    const db = database();
    assert.equal(await runCreateInviteAction(deps(db, { getSession: async () => null })), "/sign-in");
    assert.equal(db.calls.length, 0);
  });

  it("the owner: back to /app/household, and the code is not in the address", async () => {
    const db = database();
    const path = await runCreateInviteAction(deps(db));
    assert.equal(path, "/app/household");
    assert.equal(db.created.length, 1);
    for (const secret of [CODE, CODE.replace(/-/g, ""), inviteCodeFingerprint(CODE), db.created[0].codeEncrypted]) {
      assert.ok(!path.includes(secret));
    }
  });

  it("a partner's session: the owner-only sentence, and no invite is created", async () => {
    const db = database();
    const path = await runCreateInviteAction(deps(db, { getSession: async () => PARTNER }));
    assert.equal(path, "/app/household?error=not_owner");
    assert.equal(householdErrorSentence(readHouseholdError("not_owner") ?? "unknown"), "Only the person who created the household can invite a partner.");
    assert.equal(db.created.length, 0);
    assert.equal(db.calls[0].customerId, PARTNER.customerId);
  });

  it("SIGNUPS_ENABLED off: the paused sentence, and no database call", async () => {
    const db = database();
    const path = await runCreateInviteAction(deps(db, { signupsEnabled: () => false }));
    assert.equal(path, "/app/household?error=paused");
    assert.equal(householdErrorSentence("paused"), "New sign-ups are paused right now.");
    assert.equal(db.calls.length, 0);
  });

  it("WRITES_ENABLED has no effect: the action takes no money switch", () => {
    assert.ok(!("writesEnabled" in deps(database())));
  });

  for (const [code, expected] of [
    ["household_full", "/app/household?error=household_full"],
    ["limit_invites", "/app/household?error=limit_invites"],
    ["bad_request", "/app/household?error=unknown"],
    ["unknown", "/app/household?error=unknown"],
  ] as const) {
    it(`a ${code} refusal goes to ${expected}`, async () => {
      const db = database();
      const path = await runCreateInviteAction(deps(db, { createInvite: async () => ({ ok: false, code }) }));
      assert.equal(path, expected);
    });
  }
});

describe("the address's error code", () => {
  it("the list is fixed", () => {
    assert.deepEqual([...HOUSEHOLD_ERROR_CODES], ["paused", "not_owner", "household_full", "limit_invites", "unknown"]);
  });

  it("every code on the list has its approved sentence", () => {
    assert.equal(householdErrorSentence("paused"), "New sign-ups are paused right now.");
    assert.equal(householdErrorSentence("not_owner"), "Only the person who created the household can invite a partner.");
    assert.equal(householdErrorSentence("household_full"), "Your partner has joined. Your household is full.");
    assert.equal(householdErrorSentence("limit_invites"), "You have made too many invite codes today. Please try again tomorrow.");
    assert.equal(householdErrorSentence("unknown"), "We could not create an invite code right now. Please try again.");
  });

  for (const value of ["code_taken", "bad_request", "NOT_OWNER", " not_owner", CODE, "", undefined, ["not_owner"], 3]) {
    it(`${JSON.stringify(value) ?? "undefined"} shows no sentence`, () => {
      assert.equal(readHouseholdError(value), null);
    });
  }

  it("every path the action can give carries a code from the list or none", () => {
    const outcomes = [
      { status: "created" },
      { status: "signed_out" },
      { status: "paused", message: "x" },
      { status: "refused", code: "not_owner", message: "x" },
      { status: "refused", code: "code_taken", message: "x" },
    ] as const;
    for (const outcome of outcomes) {
      const path = pathAfterCreateInvite(outcome);
      const error = new URL(path, "http://localhost").searchParams.get("error");
      assert.ok(error === null || readHouseholdError(error) !== null, path);
    }
  });
});

describe("which view, and the /app banner", () => {
  const owner = (isYou: boolean): HouseholdMember => ({ fullName: "Ada Okafor", memberRole: "owner", isYou });
  const partner = (isYou: boolean): HouseholdMember => ({ fullName: "Tunde Okafor", memberRole: "partner", isYou });
  const members = (list: HouseholdMember[]): ReadMembersOutcome => ({ status: "members", members: list });

  it("householdView", () => {
    assert.equal(householdView([owner(true)]), "owner_alone");
    assert.equal(householdView([owner(true), partner(false)]), "owner_full");
    assert.equal(householdView([owner(false), partner(true)]), "partner");
    assert.equal(householdView([owner(false), partner(false)]), null);
  });

  it("the banner shows only for a lone owner", () => {
    assert.equal(showLoneOwnerBanner(members([owner(true)])), true);
  });

  it("not for a partner, not for an owner with a partner, not when the read fails", () => {
    assert.equal(showLoneOwnerBanner(members([owner(false), partner(true)])), false);
    assert.equal(showLoneOwnerBanner(members([owner(true), partner(false)])), false);
    assert.equal(showLoneOwnerBanner({ status: "failed", message: "x" }), false);
    assert.equal(showLoneOwnerBanner({ status: "signed_out" }), false);
    assert.equal(showLoneOwnerBanner(members([partner(true)])), false);
  });
});

describe("source checks", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const PAGE = read("../app/app/household/page.tsx");
  const ACTION = read("../app/app/household/actions.ts");
  const code = (text: string) => text.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  it("the page waits for a visit, then calls requireSession before any read", () => {
    const body = code(PAGE);
    const connectionAt = body.indexOf("await connection()");
    const sessionAt = body.indexOf("await requireSession()");
    assert.ok(connectionAt !== -1 && sessionAt > connectionAt);
    for (const reader of ["readMyHouseholdMembers()", "readMyInvite()", "await searchParams"]) {
      const at = body.indexOf(reader, body.indexOf("export default"));
      assert.ok(at > sessionAt, `${reader} comes before requireSession`);
    }
  });

  it("the page reads the invite only in the owner-alone view", () => {
    assert.match(code(PAGE), /if \(view === "owner_alone"\) \{\s+invite = await readMyInvite\(\);/);
  });

  it("the action calls the session before anything else", () => {
    const body = code(ACTION).slice(code(ACTION).indexOf("export async function createInviteAction"));
    const firstAwait = body.indexOf("await ");
    assert.equal(body.slice(firstAwait, firstAwait + "await getSession()".length), "await getSession()");
    assert.ok(body.indexOf('redirect("/sign-in")') < body.indexOf("runCreateInviteAction("));
    assert.ok(!/formData|searchParams|household_id/i.test(body));
  });

  it("the action takes no money switch", () => {
    assert.ok(!/writesEnabled/.test(code(ACTION)));
  });

  for (const path of [
    "../app/app/household/page.tsx",
    "../app/app/household/actions.ts",
    "../app/app/household/submit-button.tsx",
    "../app/app/household/page.module.css",
    "./household-screen.ts",
    "../app/app/page.tsx",
  ]) {
    it(`${path}: no console calls, no forbidden words, no em dashes`, () => {
      const source = read(path);
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }

  it("the code is shown as selectable text, with no copy script", () => {
    assert.match(read("../app/app/household/page.module.css"), /\.code \{[^}]*user-select: all;/);
    assert.ok(!/clipboard|AccessCode/.test(PAGE));
  });

  it("/app has the Household link and the banner, read after the session", () => {
    const app = code(read("../app/app/page.tsx"));
    assert.match(app, /href="\/app\/household" className=\{styles\.profileLink\}>\s+Household/);
    assert.match(app, /You're the only one here yet\. Invite your partner from Household\./);
    assert.ok(app.indexOf("await requireSession()") < app.indexOf("readMyHouseholdMembers()", app.indexOf("export default")));
  });
});
