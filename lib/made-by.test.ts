// Tests for recording and showing who made each transaction.
//
// Run with:  npm test
//
// Stand-ins replace the session, the switch and the database. Nothing
// real is read or written.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { errorSentence, readErrorCode } from "./errors.ts";
import { runAddMoneyAction, runMoveMoneyAction, type AddMoneyActionDeps, type MoveMoneyActionDeps } from "./money-actions-core.ts";
import { runAddMoney, runMoveMoney, type HouseholdAccount, type MoveDeps, type PostOutcome, type PostRequest } from "./moves-core.ts";
import type { SessionPerson } from "./session-core.ts";
import { madeByLine, toStatementLine } from "./statement.ts";

const HOUSEHOLD = "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_HOUSEHOLD = "b2b2b2b2-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BANK = "a1000000-0000-4000-8000-00000000000a";
const WALLET = "a2000000-0000-4000-8000-00000000000a";
const POT = "a3000000-0000-4000-8000-00000000000a";
const STRANGER = "f9e8d7c6-b5a4-4f3e-8d2c-1b0a9f8e7d6c";
const RAW = "RAW-DATABASE-WORDING";

const OWNER: SessionPerson = {
  customerId: "c1a1a1a1-cccc-4ccc-8ccc-cccccccccccc",
  householdId: HOUSEHOLD,
  householdName: "Okafor household",
  fullName: "Ada Okafor",
  role: "wife",
};
const PARTNER: SessionPerson = { ...OWNER, customerId: "d2d2d2d2-dddd-4ddd-8ddd-dddddddddddd", fullName: "Tunde Okafor", role: "husband" };

const ACCOUNTS: HouseholdAccount[] = [
  { account_id: BANK, name: "Hearth Bank", kind: "bank_source", balance_kobo: "-500000" },
  { account_id: WALLET, name: "Family Wallet", kind: "wallet", balance_kobo: "400000" },
  { account_id: POT, name: "Rent", kind: "pot", balance_kobo: "100000" },
];

function database(answer: PostOutcome = { kind: "posted", replayed: false }) {
  const posted: PostRequest[] = [];
  let loads = 0;
  const deps: MoveDeps = {
    writesEnabled: () => true,
    loadHouseholdAccounts: async () => {
      loads += 1;
      return { kind: "loaded", accounts: ACCOUNTS.map((a) => ({ ...a })) };
    },
    postTransaction: async (request) => {
      posted.push(request);
      return answer;
    },
    logError: () => {},
  };
  return { deps, posted, calls: () => loads + posted.length };
}

function actions(session: SessionPerson | null, answer?: PostOutcome, writesOn = true) {
  const db = database(answer);
  const add: AddMoneyActionDeps = {
    writesEnabled: () => writesOn,
    getSession: async () => session,
    addMoney: (householdId, createdBy, input) => runAddMoney(householdId, createdBy, input, db.deps),
  };
  const move: MoveMoneyActionDeps = {
    writesEnabled: () => writesOn,
    getSession: async () => session,
    moveMoney: (householdId, createdBy, input) => runMoveMoney(householdId, createdBy, input, db.deps),
  };
  return { add, move, db };
}

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    form.append(name, value);
  }
  return form;
}

const addForm = (extra: Record<string, string> = {}) => formWith({ amount: "100.00", idempotencyKey: randomUUID(), ...extra });
const moveForm = (extra: Record<string, string> = {}) =>
  formWith({ amount: "100.00", fromAccountId: WALLET, toAccountId: POT, idempotencyKey: randomUUID(), ...extra });

describe("the money actions record who made each transaction", () => {
  it("Add money passes the session's household and person unchanged", async () => {
    const s = actions(OWNER);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/app?notice=added");
    assert.equal(s.db.posted.length, 1);
    assert.equal(s.db.posted[0].householdId, OWNER.householdId);
    assert.equal(s.db.posted[0].createdBy, OWNER.customerId);
  });

  it("Move money passes the session's household and person unchanged", async () => {
    const s = actions(OWNER);
    assert.equal(await runMoveMoneyAction(moveForm(), s.move), "/app?notice=moved");
    assert.equal(s.db.posted[0].householdId, OWNER.householdId);
    assert.equal(s.db.posted[0].createdBy, OWNER.customerId);
  });

  it("form fields named created_by, customer_id or household_id change nothing", async () => {
    const extra = { created_by: STRANGER, createdBy: STRANGER, customer_id: STRANGER, household_id: OTHER_HOUSEHOLD };
    for (const run of [
      async () => {
        const s = actions(OWNER);
        await runAddMoneyAction(addForm(extra), s.add);
        return s.db.posted;
      },
      async () => {
        const s = actions(OWNER);
        await runMoveMoneyAction(moveForm(extra), s.move);
        return s.db.posted;
      },
    ]) {
      const posted = await run();
      assert.equal(posted.length, 1);
      assert.equal(posted[0].createdBy, OWNER.customerId);
      assert.equal(posted[0].householdId, HOUSEHOLD);
      assert.ok(!JSON.stringify(posted).includes(STRANGER));
      assert.ok(!JSON.stringify(posted).includes(OTHER_HOUSEHOLD));
    }
  });

  it("a partner's session works for both, and carries the partner's id", async () => {
    const add = actions(PARTNER);
    assert.equal(await runAddMoneyAction(addForm(), add.add), "/app?notice=added");
    assert.equal(add.db.posted[0].createdBy, PARTNER.customerId);
    const move = actions(PARTNER);
    assert.equal(await runMoveMoneyAction(moveForm(), move.move), "/app?notice=moved");
    assert.equal(move.db.posted[0].createdBy, PARTNER.customerId);
    assert.equal(move.db.posted[0].householdId, HOUSEHOLD);
  });

  it("no session: /sign-in, and no database call", async () => {
    const s = actions(null);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/sign-in");
    assert.equal(await runMoveMoneyAction(moveForm(), s.move), "/sign-in");
    assert.equal(s.db.calls(), 0);
  });

  it("writes off: the paused outcome first, even with no session", async () => {
    const s = actions(null, undefined, false);
    assert.equal(await runAddMoneyAction(addForm(), s.add), "/app/add-money?error=writes_off");
    assert.equal(await runMoveMoneyAction(moveForm(), s.move), "/app/move-money?error=writes_off");
    assert.equal(s.db.calls(), 0);
  });

  it("a malformed person id from the caller: unknown, and the database is not asked", async () => {
    const db = database();
    const result = await runAddMoney(HOUSEHOLD, "not-a-person", { amount: "100", idempotencyKey: randomUUID() }, db.deps);
    assert.deepEqual(result, { status: "refused", code: "unknown" });
    assert.equal(db.calls(), 0);
  });
});

describe("not_member and bad_request from the database", () => {
  for (const message of [
    `not_member: The person making this transaction is not a member of its household. ${RAW}`,
    `bad_request: The person making the transaction is required. ${RAW}`,
  ]) {
    const code = message.slice(0, message.indexOf(":"));
    it(`${code} goes to the existing "unknown" sentence, with none of the database's words`, async () => {
      const answer: PostOutcome = { kind: "database_error", code: code === "not_member" ? "42501" : "22023", message };
      const add = actions(OWNER, answer);
      const addPath = await runAddMoneyAction(addForm(), add.add);
      assert.equal(addPath, "/app/add-money?error=unknown");
      const move = actions(OWNER, answer);
      const movePath = await runMoveMoneyAction(moveForm(), move.move);
      assert.equal(movePath, "/app/move-money?error=unknown");
      for (const path of [addPath, movePath]) {
        assert.ok(!path.includes(RAW));
        assert.ok(!path.includes(code));
      }
      assert.equal(errorSentence(readErrorCode("unknown") ?? "unknown"), errorSentence("unknown"));
    });
  }

  it("the unknown sentence holds no database words", () => {
    assert.ok(!errorSentence("unknown").includes(RAW));
    assert.ok(!/not_member|bad_request/.test(errorSentence("unknown")));
  });
});

describe("the statement's \"by <name>\" line", () => {
  const ROW = { description: "Add money to the wallet", created_at: "2026-11-27T10:00:00+00:00", amount_kobo: "10000", balance_after_kobo: "10000" };

  it("shows \"by <full name>\" when the view gives a name", () => {
    const line = toStatementLine({ ...ROW, made_by_name: "Tunde Okafor" });
    assert.equal(line.made_by_name, "Tunde Okafor");
    assert.equal(madeByLine(line), "by Tunde Okafor");
  });

  it("shows nothing when the view gives null (older lines, the bank side)", () => {
    assert.equal(madeByLine(toStatementLine({ ...ROW, made_by_name: null })), null);
    assert.equal(madeByLine(toStatementLine(ROW)), null);
    assert.equal(madeByLine(toStatementLine({ ...ROW, made_by_name: "   " })), null);
  });

  it("refuses a name that is not text", () => {
    for (const value of [7, true, { name: "x" }, ["x"]]) {
      assert.throws(() => toStatementLine({ ...ROW, made_by_name: value }));
    }
  });

  it("keeps nothing else from the row", () => {
    const line = toStatementLine({ ...ROW, made_by_name: "Ada Okafor", seq: 4, created_by: STRANGER });
    assert.deepEqual(line, { ...ROW, made_by_name: "Ada Okafor" });
  });
});

describe("source checks", () => {
  const ROOT = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

  function sourceFiles(folder: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(new URL(folder, ROOT), { withFileTypes: true })) {
      const path = `${folder}${entry.name}`;
      if (entry.isDirectory()) {
        found.push(...sourceFiles(`${path}/`));
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        found.push(path);
      }
    }
    return found;
  }

  it("the old post_transaction is named in no non-test file under lib/ or app/", () => {
    const files = [...sourceFiles("lib/"), ...sourceFiles("app/")];
    assert.ok(files.length > 40);
    const naming = files.filter((path) => /post_transaction(?!_by)/.test(read(path)));
    assert.deepEqual(naming, []);
  });

  it("the app calls post_transaction_by with the person from the request", () => {
    const moves = read("lib/moves.ts");
    assert.match(moves, /\.rpc\("post_transaction_by", \{/);
    assert.match(moves, /p_created_by: request\.createdBy,/);
  });

  it("the statement reader selects made_by_name, and the page shows it only when present", () => {
    assert.match(read("lib/ledger.ts"), /\.select\("description, created_at, amount_kobo::text, balance_after_kobo::text, made_by_name"\)/);
    const page = read("app/app/accounts/[id]/page.tsx");
    assert.match(page, /\{madeBy !== null \? <p className=\{styles\.madeBy\}>\{madeBy\}<\/p> : null\}/);
  });

  for (const path of [
    "lib/moves-core.ts",
    "lib/moves.ts",
    "lib/money-actions-core.ts",
    "lib/statement.ts",
    "lib/ledger.ts",
    "app/app/accounts/[id]/page.tsx",
    "app/app/accounts/[id]/page.module.css",
  ]) {
    it(`${path}: no forbidden words, no em dashes`, () => {
      const source = read(path);
      assert.ok(!/fake/i.test(source), "forbidden word 1");
      assert.ok(!/demo/i.test(source), "forbidden word 2");
      assert.ok(!source.includes("—"), "em dash");
    });
  }

  for (const path of ["lib/money-actions-core.ts", "lib/statement.ts", "app/app/accounts/[id]/page.tsx"]) {
    it(`${path}: no console calls`, () => {
      assert.ok(!/console\s*\./.test(read(path)));
    });
  }
});
