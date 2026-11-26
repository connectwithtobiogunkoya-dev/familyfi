// Tests for recognising the signed-in person and showing their code.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { encryptAccessCode } from "./access-code-crypto.ts";
import { readMyAccessCode, resolveSession, type SessionPerson } from "./session-core.ts";
import { generateSessionToken, sessionTokenFingerprint } from "./session-token.ts";

const PERSON: SessionPerson = {
  customerId: "c1111111-1111-4111-8111-111111111111",
  householdId: "a2222222-2222-4222-8222-222222222222",
  householdName: "Okafor household",
  fullName: "Ada Okafor",
  role: "wife",
};

function sessionReader(person: SessionPerson | null) {
  const asked: string[] = [];
  return {
    asked,
    getSessionRow: async (tokenHash: string) => {
      asked.push(tokenHash);
      return person;
    },
  };
}

describe("resolveSession", () => {
  it("no cookie gives null, without asking the database", async () => {
    const r = sessionReader(PERSON);
    assert.equal(await resolveSession(undefined, r.getSessionRow), null);
    assert.equal(r.asked.length, 0);
  });

  for (const [label, value] of [
    ["an empty cookie", ""],
    ["a short cookie", "abc"],
    ["a cookie with odd characters", `${"A".repeat(42)}+`],
    ["a cookie that is not text", 12345],
  ] as const) {
    it(`${label} gives null, without asking the database`, async () => {
      const r = sessionReader(PERSON);
      assert.equal(await resolveSession(value, r.getSessionRow), null);
      assert.equal(r.asked.length, 0);
    });
  }

  it("a good cookie gives the person, and only the token's fingerprint is sent", async () => {
    const token = generateSessionToken();
    const r = sessionReader(PERSON);
    assert.deepEqual(await resolveSession(token, r.getSessionRow), PERSON);
    assert.deepEqual(r.asked, [sessionTokenFingerprint(token)]);
  });

  it("a good cookie with no session in the database gives null", async () => {
    assert.equal(await resolveSession(generateSessionToken(), sessionReader(null).getSessionRow), null);
  });

  it("a database read that throws gives null", async () => {
    assert.equal(
      await resolveSession(generateSessionToken(), async () => {
        throw new Error("down");
      }),
      null,
    );
  });
});

describe("readMyAccessCode", () => {
  const KEY = randomBytes(32);
  const CODE = "K7QM-3XPD-9RTA-W2FH";

  function material(locked: string, keyVersion = 1) {
    const asked: string[] = [];
    return {
      asked,
      deps: {
        getAccessCodeMaterial: async (customerId: string) => {
          asked.push(customerId);
          return { codeEncrypted: locked, keyVersion };
        },
        accessCodeKeys: () => new Map([[1, KEY]]),
      },
    };
  }

  it("unlocks the signed-in person's own code, asked for by their own id", async () => {
    const m = material(encryptAccessCode(CODE, KEY));
    assert.equal(await readMyAccessCode(PERSON, m.deps), CODE);
    assert.deepEqual(m.asked, [PERSON.customerId]);
  });

  it("no person gives null, without asking the database", async () => {
    const m = material(encryptAccessCode(CODE, KEY));
    assert.equal(await readMyAccessCode(null, m.deps), null);
    assert.equal(m.asked.length, 0);
  });

  it("a copy that will not unlock gives null", async () => {
    assert.equal(await readMyAccessCode(PERSON, material(encryptAccessCode(CODE, randomBytes(32))).deps), null);
    assert.equal(await readMyAccessCode(PERSON, material("not.a.copy").deps), null);
  });

  it("no key for that key version gives null", async () => {
    assert.equal(await readMyAccessCode(PERSON, material(encryptAccessCode(CODE, KEY), 2).deps), null);
  });

  it("no keys at all gives null", async () => {
    const m = material(encryptAccessCode(CODE, KEY));
    assert.equal(await readMyAccessCode(PERSON, { ...m.deps, accessCodeKeys: () => null }), null);
  });

  it("no locked copy in the database gives null", async () => {
    assert.equal(
      await readMyAccessCode(PERSON, { getAccessCodeMaterial: async () => null, accessCodeKeys: () => new Map([[1, KEY]]) }),
      null,
    );
  });
});

describe("getMyAccessCode takes no id from its caller", () => {
  it("its signature in lib/session.ts has no parameter", () => {
    const source = readFileSync(new URL("./session.ts", import.meta.url), "utf8");
    assert.match(source, /export async function getMyAccessCode\(\): Promise<string \| null>/);
  });
});
