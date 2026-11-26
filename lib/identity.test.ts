// Tests for the sign-up details and the simulated identity check.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkIdentity,
  generateTestDetails,
  isEighteenOrOver,
  lagosDate,
  type IdentityInput,
  type IdentityResult,
} from "./identity.ts";

// A fixed "now": midday in Lagos on 26 November 2026.
const NOW = new Date("2026-11-26T11:00:00Z");

const GOOD: IdentityInput = {
  fullName: "Ada Okafor",
  phone: "00012345678",
  dateOfBirth: "1990-05-17",
  role: "wife",
  nin: "00011112222",
  bvn: "00033334444",
  householdName: "",
  testTermsAccepted: true,
};

function check(changes: Partial<IdentityInput>, now: Date = NOW): IdentityResult {
  return checkIdentity({ ...GOOD, ...changes }, now);
}

function problemOf(result: IdentityResult, field: keyof IdentityInput): string | undefined {
  return result.outcome === "field_errors" ? result.fields[field]?.problem : undefined;
}

// A small, repeatable random source (mulberry32), so tests give the same
// results every run.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("checkIdentity: good details pass", () => {
  it("the good example passes, with its details", () => {
    const result = check({});
    assert.equal(result.outcome, "passed");
    if (result.outcome === "passed") {
      assert.deepEqual(result.details, {
        fullName: "Ada Okafor",
        phone: "00012345678",
        dateOfBirth: "1990-05-17",
        role: "wife",
        nin: "00011112222",
        bvn: "00033334444",
        householdName: "",
      });
    }
  });

  it("spaces at the ends of the name are removed", () => {
    const result = check({ fullName: "   Ada Okafor  " });
    assert.equal(result.outcome === "passed" && result.details.fullName, "Ada Okafor");
  });

  it("a phone typed with spaces and hyphens is tidied", () => {
    for (const typed of ["000 1234 5678", "000-1234-5678", " 000 1234-5678 "]) {
      const result = check({ phone: typed });
      assert.equal(result.outcome === "passed" && result.details.phone, "00012345678", typed);
    }
  });

  it("husband is accepted as well as wife", () => {
    assert.equal(check({ role: "husband" }).outcome, "passed");
  });

  it("a household name is trimmed and kept", () => {
    const result = check({ householdName: "  The Okafors  " });
    assert.equal(result.outcome === "passed" && result.details.householdName, "The Okafors");
  });

  it("a missing household name is allowed and becomes an empty string", () => {
    const result = check({ householdName: undefined });
    assert.equal(result.outcome === "passed" && result.details.householdName, "");
  });

  it("names of exactly 2 and exactly 100 characters pass", () => {
    assert.equal(check({ fullName: "Al" }).outcome, "passed");
    assert.equal(check({ fullName: "A".repeat(100) }).outcome, "passed");
  });

  it("letters made of two units count as one character, as in the database", () => {
    // 100 characters, each of which JavaScript stores as two units.
    assert.equal(check({ fullName: "𝒜".repeat(100) }).outcome, "passed");
    assert.equal(problemOf(check({ fullName: "𝒜".repeat(101) }), "fullName"), "too_long");
  });

  it("a household name of exactly 60 characters passes", () => {
    assert.equal(check({ householdName: "H".repeat(60) }).outcome, "passed");
  });
});

describe("checkIdentity: each field refused", () => {
  const cases: Array<[label: string, changes: Partial<IdentityInput>, field: keyof IdentityInput, problem: string]> = [
    ["no name", { fullName: "" }, "fullName", "missing"],
    ["a name of only spaces", { fullName: "    " }, "fullName", "missing"],
    ["a name that is not text", { fullName: 42 }, "fullName", "missing"],
    ["a name of 1 character", { fullName: "A" }, "fullName", "too_short"],
    ["a name of 101 characters", { fullName: "A".repeat(101) }, "fullName", "too_long"],
    ["a name with a line break", { fullName: "Ada\nOkafor" }, "fullName", "bad_characters"],
    ["no phone", { phone: "" }, "phone", "missing"],
    ["a real-looking phone", { phone: "08012345678" }, "phone", "not_test_number"],
    ["a phone with +234", { phone: "+2348012345678" }, "phone", "not_test_number"],
    ["a test phone one digit short", { phone: "0001234567" }, "phone", "not_test_number"],
    ["a test phone one digit long", { phone: "000123456789" }, "phone", "not_test_number"],
    ["a phone with a dot", { phone: "000.1234.5678" }, "phone", "not_test_number"],
    ["no date of birth", { dateOfBirth: "" }, "dateOfBirth", "missing"],
    ["a date written day first", { dateOfBirth: "17/05/1990" }, "dateOfBirth", "not_a_date"],
    ["31 February", { dateOfBirth: "1990-02-31" }, "dateOfBirth", "not_a_date"],
    ["month 13", { dateOfBirth: "1990-13-01" }, "dateOfBirth", "not_a_date"],
    ["29 February in a year without one", { dateOfBirth: "1990-02-29" }, "dateOfBirth", "not_a_date"],
    ["before 1900", { dateOfBirth: "1899-12-31" }, "dateOfBirth", "before_1900"],
    ["in the future", { dateOfBirth: "2026-11-27" }, "dateOfBirth", "in_future"],
    ["under 18", { dateOfBirth: "2010-01-01" }, "dateOfBirth", "under_18"],
    ["no role", { role: "" }, "role", "missing"],
    ["a role in capitals", { role: "Wife" }, "role", "not_a_role"],
    ["another role", { role: "partner" }, "role", "not_a_role"],
    ["no NIN", { nin: "" }, "nin", "missing"],
    ["a NIN not starting with 000", { nin: "12345678901" }, "nin", "not_test_number"],
    ["a NIN with a space", { nin: "000 1111 2222" }, "nin", "not_test_number"],
    ["no BVN", { bvn: "" }, "bvn", "missing"],
    ["a BVN not starting with 000", { bvn: "22233334444" }, "bvn", "not_test_number"],
    ["a household name of 61 characters", { householdName: "H".repeat(61) }, "householdName", "too_long"],
    ["a household name with a tab", { householdName: "The\tOkafors" }, "householdName", "bad_characters"],
    ["the box not ticked", { testTermsAccepted: false }, "testTermsAccepted", "not_ticked"],
    ["the box sent as text", { testTermsAccepted: "on" }, "testTermsAccepted", "not_ticked"],
  ];

  for (const [label, changes, field, problem] of cases) {
    it(`${label}: ${field} is refused as ${problem}`, () => {
      const result = check(changes);
      assert.equal(result.outcome, "field_errors");
      assert.equal(problemOf(result, field), problem);
    });
  }

  it("every field wrong at once gives one problem for each field", () => {
    const result = checkIdentity(
      {
        fullName: "",
        phone: "x",
        dateOfBirth: "x",
        role: "x",
        nin: "x",
        bvn: "x",
        householdName: "H".repeat(61),
        testTermsAccepted: false,
      },
      NOW,
    );
    assert.equal(result.outcome, "field_errors");
    if (result.outcome === "field_errors") {
      assert.deepEqual(Object.keys(result.fields).sort(), [
        "bvn",
        "dateOfBirth",
        "fullName",
        "householdName",
        "nin",
        "phone",
        "role",
        "testTermsAccepted",
      ]);
    }
  });
});

describe("checkIdentity: the simulated identity check", () => {
  it("a NIN ending in 99 does not pass", () => {
    assert.deepEqual(check({ nin: "00011112299" }), { outcome: "not_verified" });
  });

  it("a BVN ending in 99 does not pass", () => {
    assert.deepEqual(check({ bvn: "00033334499" }), { outcome: "not_verified" });
  });

  it("both ending in 99 does not pass", () => {
    assert.deepEqual(check({ nin: "00011112299", bvn: "00033334499" }), { outcome: "not_verified" });
  });

  it("ending in a single 9, or 99 in the middle, passes", () => {
    assert.equal(check({ nin: "00011112229" }).outcome, "passed");
    assert.equal(check({ nin: "00099112222" }).outcome, "passed");
  });
});

describe("checkIdentity: the order of outcomes", () => {
  it("a field problem comes before the simulated check", () => {
    const result = check({ nin: "00011112299", phone: "08012345678" });
    assert.equal(result.outcome, "field_errors");
    assert.equal(problemOf(result, "phone"), "not_test_number");
  });

  it("being under 18 comes before the simulated check", () => {
    const result = check({ bvn: "00033334499", dateOfBirth: "2012-06-01" });
    assert.equal(problemOf(result, "dateOfBirth"), "under_18");
  });

  it("an unticked box comes before the simulated check", () => {
    const result = check({ nin: "00011112299", testTermsAccepted: false });
    assert.equal(problemOf(result, "testTermsAccepted"), "not_ticked");
  });

  it("a NIN in the wrong form is a field problem, not a failed check, even if it ends in 99", () => {
    const result = check({ nin: "12345678999" });
    assert.equal(problemOf(result, "nin"), "not_test_number");
  });
});

describe("checkIdentity: nothing typed ever appears in a message", () => {
  const typed: IdentityInput = {
    fullName: "Q",
    phone: "777-TYPED-PHONE",
    dateOfBirth: "TYPED-DATE",
    role: "TYPED-ROLE",
    nin: "TYPED-NIN-12345",
    bvn: "TYPED-BVN-67890",
    householdName: `TYPED-HOUSEHOLD-${"x".repeat(60)}`,
    testTermsAccepted: "TYPED-BOX",
  };

  it("no message contains any typed value", () => {
    const result = checkIdentity(typed, NOW);
    assert.equal(result.outcome, "field_errors");
    const text = JSON.stringify(result);
    for (const value of Object.values(typed)) {
      if (typeof value === "string" && value.length > 1) {
        assert.ok(!text.includes(value), `a message contains ${value}`);
      }
    }
    assert.ok(!text.includes("TYPED"));
  });

  it("no message contains a real-looking number that was typed", () => {
    const result = check({ phone: "08098765432", nin: "98765432101", bvn: "12312312312" });
    const text = JSON.stringify(result);
    for (const value of ["08098765432", "98765432101", "12312312312"]) {
      assert.ok(!text.includes(value));
    }
  });

  it("no message contains four or more digits in a row (only the fixed \"000\" and \"11\" appear)", () => {
    const result = checkIdentity(typed, NOW);
    if (result.outcome === "field_errors") {
      for (const error of Object.values(result.fields)) {
        assert.ok(!/[0-9]{4,}/.test(error?.message ?? ""), error?.message);
        assert.ok(!/fake|demo/i.test(error?.message ?? ""));
      }
    }
  });
});

describe("age: 18 or over by the calendar in Lagos", () => {
  it("on the 18th birthday: 18", () => {
    assert.equal(isEighteenOrOver("2008-11-26", NOW), true);
  });

  it("the day before the 18th birthday: under 18", () => {
    assert.equal(isEighteenOrOver("2008-11-27", NOW), false);
  });

  it("born 29 February 2008: under 18 on 28 February 2026", () => {
    assert.equal(isEighteenOrOver("2008-02-29", new Date("2026-02-28T12:00:00Z")), false);
  });

  it("born 29 February 2008: 18 on 1 March 2026", () => {
    assert.equal(isEighteenOrOver("2008-02-29", new Date("2026-03-01T12:00:00Z")), true);
  });

  it("born 29 February 2012: 18 on 29 February 2030? No such day; 18 on 1 March 2030", () => {
    assert.equal(isEighteenOrOver("2012-02-29", new Date("2030-02-28T12:00:00Z")), false);
    assert.equal(isEighteenOrOver("2012-02-29", new Date("2030-03-01T12:00:00Z")), true);
  });

  it("uses Lagos time: 23:30 on 26 November in UTC is already 27 November in Lagos", () => {
    const lateEvening = new Date("2026-11-26T23:30:00Z");
    assert.equal(lagosDate(lateEvening), "2026-11-27");
    // Born 27 November 2008: 18 in Lagos at that moment, although the UTC
    // date is still the 26th.
    assert.equal(isEighteenOrOver("2008-11-27", lateEvening), true);
  });

  it("and an hour earlier, still 26 November in Lagos, the same person is under 18", () => {
    assert.equal(isEighteenOrOver("2008-11-27", new Date("2026-11-26T22:30:00Z")), false);
  });

  it("the sign-up check uses the same Lagos rule", () => {
    assert.equal(checkIdentity({ ...GOOD, dateOfBirth: "2008-11-27" }, new Date("2026-11-26T23:30:00Z")).outcome, "passed");
    assert.equal(
      problemOf(checkIdentity({ ...GOOD, dateOfBirth: "2008-11-27" }, new Date("2026-11-26T22:30:00Z")), "dateOfBirth"),
      "under_18",
    );
  });

  it("a date of birth that is tomorrow in Lagos is in the future", () => {
    assert.equal(problemOf(check({ dateOfBirth: "2026-11-27" }), "dateOfBirth"), "in_future");
  });
});

describe("generateTestDetails (the Fill in test details button)", () => {
  it("1,000 sets of test details all pass every check, once the box is ticked", () => {
    const random = seededRandom(20261126);
    for (let i = 0; i < 1000; i += 1) {
      const details = generateTestDetails(random, NOW);
      const result = checkIdentity({ ...details, testTermsAccepted: true }, NOW);
      assert.equal(result.outcome, "passed", JSON.stringify(details));
    }
  });

  it("the NIN and BVN never end in 99", () => {
    const random = seededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const details = generateTestDetails(random, NOW);
      assert.ok(!details.nin.endsWith("99") && !details.bvn.endsWith("99"));
    }
  });

  it("phone, NIN and BVN are test numbers", () => {
    const details = generateTestDetails(seededRandom(1), NOW);
    for (const value of [details.phone, details.nin, details.bvn]) {
      assert.match(value, /^000[0-9]{8}$/);
    }
  });

  it("the person is always an adult", () => {
    const random = seededRandom(99);
    for (let i = 0; i < 300; i += 1) {
      assert.ok(isEighteenOrOver(generateTestDetails(random, NOW).dateOfBirth, NOW));
    }
  });

  it("the same random source gives the same details", () => {
    assert.deepEqual(generateTestDetails(seededRandom(5), NOW), generateTestDetails(seededRandom(5), NOW));
  });

  it("different random sources give different details", () => {
    assert.notDeepEqual(generateTestDetails(seededRandom(5), NOW), generateTestDetails(seededRandom(6), NOW));
  });

  it("a random source that gives a number outside 0 to 1 is refused", () => {
    assert.throws(() => generateTestDetails(() => 1, NOW), RangeError);
    assert.throws(() => generateTestDetails(() => -0.1, NOW), RangeError);
    assert.throws(() => generateTestDetails(() => Number.NaN, NOW), RangeError);
  });
});
