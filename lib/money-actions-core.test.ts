// Tests for the join: every page and money action works only on the
// signed-in person's own household.
//
// Run with:  npm test
//
// Stand-ins replace the session, the switch and the database. Two
// households, A and B, each with a bank account, a wallet and a pot.
// Person A is signed in. Nothing real is read or written.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { readAccountStatement, readHouseholdBalances, type LedgerReader } from "./ledger-core.ts";
import { runAddMoneyAction, runMoveMoneyAction, type AddMoneyActionDeps, type MoveMoneyActionDeps } from "./money-actions-core.ts";
import { runAddMoney, runMoveMoney, type HouseholdAccount, type MoveDeps, type PostRequest } from "./moves-core.ts";
import { resolveSession, type SessionPerson } from "./session-core.ts";
import { generateSessionToken } from "./session-token.ts";

const HOUSEHOLD_A = "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSEHOLD_B = "b2b2b2b2-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const A = {
  bank: "a1000000-0000-4000-8000-00000000000a",
  wallet: "a2000000-0000-4000-8000-00000000000a",
  pot: "a3000000-0000-4000-8000-00000000000a",
};
const B = {
  bank: "b1000000-0000-4000-8000-00000000000b",
  wallet: "b2000000-0000-4000-8000-00000000000b",
  pot: "b3000000-0000-4000-8000-00000000000b",
};

const ACCOUNTS: Record<string, HouseholdAccount[]> = {
  [HOUSEHOLD_A]: [
    { account_id: A.bank, name: "Hearth Bank", kind: "bank_source", balance_kobo: "-5000000" },
    { account_id: A.wallet, name: "Family Wallet", kind: "wallet", balance_kobo: "4000000" },
    { account_id: A.pot, name: "Rent", kind: "pot", balance_kobo: "1000000" },
  ],
  [HOUSEHOLD_B]: [
    { account_id: B.bank, name: "Hearth Bank", kind: "bank_source", balance_kobo: "-9000000" },
    { account_id: B.wallet, name: "Family Wallet", kind: "wallet", balance_kobo: "8000000" },
    { account_id: B.pot, name: "Rent", kind: "pot", balance_kobo: "1000000" },
  ],
};

const PERSON_A: SessionPerson = {
  customerId: "c1a1a1a1-cccc-4ccc-8ccc-cccccccccccc",
  householdId: HOUSEHOLD_A,
  householdName: "Okafor household",
  fullName: "Ada Okafor",
  role: "wife",
};

// The money database: each household sees only its own accounts.
function standInDatabase() {
  const loadedFor: string[] = [];
  const posted: PostRequest[] = [];
  const deps: MoveDeps = {
    writesEnabled: () => true,
    loadHouseholdAccounts: async (householdId) => {
      loadedFor.push(householdId);
      return { kind: "loaded", accounts: ACCOUNTS[householdId] ?? [] };
    },
    postTransaction: async (request) => {
      posted.push(request);
      return { kind: "posted", replayed: false };
    },
    logError: () => {},
  };
  return { deps, loadedFor, posted, databaseCalls: () => loadedFor.length + posted.length };
}

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    form.append(name, value);
  }
  return form;
}

// The action deps, wired to the real money rules and the stand-in
// database, with a chosen session and switch.
function actions(session: SessionPerson | null | (() => never), writesOn = true) {
  const db = standInDatabase();
  let sessionAsked = 0;
  let moneyCalls = 0;
  const getSession = async () => {
    sessionAsked += 1;
    if (typeof session === "function") {
      return session();
    }
    return session;
  };
  const add: AddMoneyActionDeps = {
    writesEnabled: () => writesOn,
    getSession,
    addMoney: (householdId, createdBy, input) => {
      moneyCalls += 1;
      return runAddMoney(householdId, createdBy, input, db.deps);
    },
  };
  const move: MoveMoneyActionDeps = {
    writesEnabled: () => writesOn,
    getSession,
    moveMoney: (householdId, createdBy, input) => {
      moneyCalls += 1;
      return runMoveMoney(householdId, createdBy, input, db.deps);
    },
  };
  return { add, move, db, sessionAsked: () => sessionAsked, moneyCalls: () => moneyCalls };
}

const addForm = () => formWith({ amount: "100.00", idempotencyKey: randomUUID() });
const moveForm = (from: string, to: string) => formWith({ amount: "100.00", fromAccountId: from, toAccountId: to, idempotencyKey: randomUUID() });

describe("the money actions with no session", () => {
  it("Add money: /sign-in, no money call and no database call", async () => {
    const s = actions(null);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/sign-in");
    assert.equal(s.moneyCalls(), 0);
    assert.equal(s.db.databaseCalls(), 0);
  });

  it("Move money: /sign-in, no money call and no database call", async () => {
    const s = actions(null);
    assert.equal(await runMoveMoneyAction(moveForm(A.wallet, A.pot), s.move), "/sign-in");
    assert.equal(s.moneyCalls(), 0);
    assert.equal(s.db.databaseCalls(), 0);
  });

  it("a session check that fails counts as no session", async () => {
    const s = actions(() => {
      throw new Error("down");
    });
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/sign-in");
    assert.equal(await runMoveMoneyAction(moveForm(A.wallet, A.pot), s.move), "/sign-in");
    assert.equal(s.moneyCalls(), 0);
    assert.equal(s.db.databaseCalls(), 0);
  });
});

describe("the write switch is still checked first", () => {
  it("writes off and no session: the paused outcome, not a redirect to /sign-in", async () => {
    const s = actions(null, false);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/app/add-money?error=writes_off");
    assert.equal(await runMoveMoneyAction(moveForm(A.wallet, A.pot), s.move), "/app/move-money?error=writes_off");
    assert.equal(s.sessionAsked(), 0);
    assert.equal(s.moneyCalls(), 0);
    assert.equal(s.db.databaseCalls(), 0);
  });

  it("writes off and signed in: still the paused outcome, and nothing is asked", async () => {
    const s = actions(PERSON_A, false);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/app/add-money?error=writes_off");
    assert.equal(s.sessionAsked(), 0);
    assert.equal(s.db.databaseCalls(), 0);
  });
});

describe("with person A signed in: Add money", () => {
  it("uses A's household, A's bank and A's wallet, and posts", async () => {
    const s = actions(PERSON_A);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/app?notice=added");
    assert.deepEqual(s.db.loadedFor, [HOUSEHOLD_A]);
    assert.equal(s.db.posted.length, 1);
    const used = s.db.posted[0].entries.map((entry) => entry.account_id).sort();
    assert.deepEqual(used, [A.bank, A.wallet].sort());
  });

  it("the session's household id reaches post_transaction unchanged", async () => {
    const s = actions(PERSON_A);
    await runAddMoneyAction(addForm(), s.add);
    assert.equal(s.db.posted[0].householdId, PERSON_A.householdId);
  });

  it("a form field named household_id (and similar) is ignored", async () => {
    const s = actions(PERSON_A);
    const form = addForm();
    form.append("household_id", HOUSEHOLD_B);
    form.append("householdId", HOUSEHOLD_B);
    form.append("household", HOUSEHOLD_B);
    await runAddMoneyAction(form, s.add);
    assert.deepEqual(s.db.loadedFor, [HOUSEHOLD_A]);
    assert.equal(s.db.posted[0].householdId, HOUSEHOLD_A);
    assert.ok(!JSON.stringify(s.db.posted).includes(HOUSEHOLD_B));
  });

  it("B's accounts are never touched", async () => {
    const s = actions(PERSON_A);
    await runAddMoneyAction(addForm(), s.add);
    const text = JSON.stringify(s.db.posted);
    for (const id of [HOUSEHOLD_B, B.bank, B.wallet, B.pot]) {
      assert.ok(!text.includes(id));
    }
  });
});

describe("with person A signed in: Move money", () => {
  it("a move within A posts for A, and the household id is unchanged", async () => {
    const s = actions(PERSON_A);
    assert.equal(await runMoveMoneyAction(moveForm(A.wallet, A.pot), s.move), "/app?notice=moved");
    assert.deepEqual(s.db.loadedFor, [HOUSEHOLD_A]);
    assert.equal(s.db.posted.length, 1);
    assert.equal(s.db.posted[0].householdId, PERSON_A.householdId);
  });

  for (const [label, from, to] of [
    ["A's wallet to B's pot", A.wallet, B.pot],
    ["B's pot to A's wallet", B.pot, A.wallet],
    ["B's wallet to B's pot", B.wallet, B.pot],
  ] as const) {
    it(`${label} is refused and nothing is posted`, async () => {
      const s = actions(PERSON_A);
      const path = await runMoveMoneyAction(moveForm(from, to), s.move);
      assert.match(path, /^\/app\/move-money\?error=/);
      assert.equal(s.db.posted.length, 0);
      assert.deepEqual(s.db.loadedFor, [HOUSEHOLD_A]);
    });
  }

  it("a form field named household_id is ignored here too", async () => {
    const s = actions(PERSON_A);
    const form = moveForm(B.wallet, B.pot);
    form.append("household_id", HOUSEHOLD_B);
    await runMoveMoneyAction(form, s.move);
    assert.deepEqual(s.db.loadedFor, [HOUSEHOLD_A]);
    assert.equal(s.db.posted.length, 0);
  });
});

describe("with person A signed in: balances and statements", () => {
  // The same chain the pages use: the person from the session, then the
  // readers with person.householdId.
  function reader() {
    const askedFor: string[] = [];
    const BALANCES: Record<string, unknown[]> = {
      [HOUSEHOLD_A]: ACCOUNTS[HOUSEHOLD_A].filter((a) => a.kind !== "bank_source"),
      [HOUSEHOLD_B]: ACCOUNTS[HOUSEHOLD_B].filter((a) => a.kind !== "bank_source"),
    };
    const r: LedgerReader = {
      readBalances: async (householdId) => {
        askedFor.push(householdId);
        return { data: BALANCES[householdId] ?? [], error: null };
      },
      readAccount: async (householdId, accountId) => {
        askedFor.push(householdId);
        const row = (BALANCES[householdId] ?? []).find((a) => (a as HouseholdAccount).account_id === accountId);
        return { data: row ?? null, error: null };
      },
      readStatementLines: async (householdId) => {
        askedFor.push(householdId);
        return { data: [], error: null };
      },
      logError: () => {},
    };
    return { r, askedFor };
  }

  async function signedInAsA(): Promise<SessionPerson> {
    const person = await resolveSession(generateSessionToken(), async () => PERSON_A);
    assert.ok(person !== null);
    return person;
  }

  it("balances: only A's household is asked for, and only A's accounts come back", async () => {
    const person = await signedInAsA();
    const { r, askedFor } = reader();
    const balances = await readHouseholdBalances(person.householdId, r);
    assert.deepEqual(askedFor, [HOUSEHOLD_A]);
    assert.deepEqual(balances.map((b) => b.account_id).sort(), [A.wallet, A.pot].sort());
  });

  it("a statement of A's own pot is found", async () => {
    const person = await signedInAsA();
    const { r, askedFor } = reader();
    const statement = await readAccountStatement(person.householdId, A.pot, r);
    assert.equal(statement?.account.account_id, A.pot);
    assert.ok(askedFor.every((h) => h === HOUSEHOLD_A));
  });

  for (const [label, id] of [
    ["B's wallet", B.wallet],
    ["B's pot", B.pot],
    ["B's bank account", B.bank],
  ] as const) {
    it(`a statement of ${label} gives not found`, async () => {
      const person = await signedInAsA();
      const { r, askedFor } = reader();
      assert.equal(await readAccountStatement(person.householdId, id, r), null);
      assert.ok(askedFor.every((h) => h === HOUSEHOLD_A));
    });
  }
});

describe("the page source files", () => {
  const ROOT = new URL("../", import.meta.url);

  function pages(folder: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(new URL(folder, ROOT), { withFileTypes: true })) {
      const path = `${folder}${entry.name}`;
      if (entry.isDirectory()) {
        found.push(...pages(`${path}/`));
      } else if (entry.name === "page.tsx") {
        found.push(path);
      }
    }
    return found;
  }

  const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
  const APP_PAGES = pages("app/app/");

  it("finds every page under app/app/", () => {
    assert.deepEqual(APP_PAGES.sort(), [
      "app/app/accounts/[id]/page.tsx",
      "app/app/add-money/page.tsx",
      "app/app/household/page.tsx",
      "app/app/move-money/page.tsx",
      "app/app/page.tsx",
      "app/app/profile/page.tsx",
    ]);
  });

  for (const path of APP_PAGES) {
    it(`${path}: calls requireSession before any read, and reads only the session's household`, () => {
      const source = read(path);
      const sessionAt = source.indexOf("await requireSession()");
      assert.ok(sessionAt > 0, "no requireSession call");
      for (const reader of ["getHouseholdBalances(", "getAccountStatement(", "getProfile(", "getMyAccessCode("]) {
        let at = source.indexOf(reader);
        while (at !== -1) {
          const isImport = source.lastIndexOf("import", at) > source.lastIndexOf(";", at);
          if (!isImport) {
            assert.ok(at > sessionAt, `${reader} comes before requireSession`);
          }
          at = source.indexOf(reader, at + 1);
        }
      }
      assert.ok(!/getCurrentHouseholdId/.test(source));
      for (const call of source.matchAll(/(getHouseholdBalances|getAccountStatement)\(([^,)]*)/g)) {
        assert.equal(call[2], "person.householdId", `${call[1]} is given ${call[2]}`);
      }
    });
  }

  it("the money actions take the household from the session only", () => {
    for (const path of ["app/app/add-money/actions.ts", "app/app/move-money/actions.ts"]) {
      const source = read(path);
      assert.match(source, /getSession,/);
      assert.ok(!/household/i.test(source.replace(/\/\/.*$/gm, "")), `${path} names a household outside its comments`);
    }
  });

  it("the front page is static: it reads no session, cookie or database", () => {
    const source = read("app/page.tsx");
    assert.ok(!/session|cookies|headers|connection|ledger|auth-db/.test(source.replace(/\/\/.*$/gm, "")));
    assert.match(source, /href="\/sign-up"/);
    assert.match(source, /href="\/sign-in"/);
  });

  const CHANGED = [
    "app/page.tsx",
    "app/page.module.css",
    "app/app/page.tsx",
    "app/app/page.module.css",
    "app/app/accounts/[id]/page.tsx",
    "app/app/add-money/page.tsx",
    "app/app/add-money/actions.ts",
    "app/app/move-money/page.tsx",
    "app/app/move-money/actions.ts",
    "lib/money-actions-core.ts",
  ];
  for (const path of CHANGED) {
    it(`${path}: no console calls, and neither forbidden word`, () => {
      const source = read(path);
      assert.ok(!/console\s*\./.test(source), "console call");
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }
});
