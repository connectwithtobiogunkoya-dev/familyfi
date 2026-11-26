// Tests for the kill switch.
//
// Run with:  npm test
//
// The rule being checked: writes are ON only when the setting is exactly
// "true". Everything else, including near misses, must be OFF.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { isWritesEnabledValue, signupsEnabled, writesEnabled } from "./settings.ts";

describe("isWritesEnabledValue: only the exact text \"true\" switches writes on", () => {
  it("\"true\" is ON", () => {
    assert.equal(isWritesEnabledValue("true"), true);
  });

  const offValues: Array<[label: string, value: unknown]> = [
    ["a missing setting (undefined)", undefined],
    ["null", null],
    ["an empty string", ""],
    ["\"false\"", "false"],
    ["capitals: \"TRUE\"", "TRUE"],
    ["a capital letter: \"True\"", "True"],
    ["a leading space: \" true\"", " true"],
    ["a trailing space: \"true \"", "true "],
    ["a trailing line break", "true\n"],
    ["quotes inside the value: '\"true\"'", "\"true\""],
    ["\"yes\"", "yes"],
    ["\"on\"", "on"],
    ["\"1\"", "1"],
    ["the real boolean true (settings are always text)", true],
    ["the number 1", 1],
  ];

  for (const [label, value] of offValues) {
    it(`${label} is OFF`, () => {
      assert.equal(isWritesEnabledValue(value), false);
    });
  }
});

describe("writesEnabled: reads the WRITES_ENABLED server setting", () => {
  // Remember the real setting, and put it back after each test, so these
  // tests never leave the switch in a different state than they found it.
  const original = process.env.WRITES_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.WRITES_ENABLED;
    } else {
      process.env.WRITES_ENABLED = original;
    }
  });

  it("is OFF when the setting does not exist", () => {
    delete process.env.WRITES_ENABLED;
    assert.equal(writesEnabled(), false);
  });

  it("is ON when the setting is \"true\"", () => {
    process.env.WRITES_ENABLED = "true";
    assert.equal(writesEnabled(), true);
  });

  it("is OFF when the setting is \"false\"", () => {
    process.env.WRITES_ENABLED = "false";
    assert.equal(writesEnabled(), false);
  });

  it("is OFF when the setting is \"TRUE\"", () => {
    process.env.WRITES_ENABLED = "TRUE";
    assert.equal(writesEnabled(), false);
  });

  it("notices a change straight away, without restarting the test", () => {
    process.env.WRITES_ENABLED = "true";
    assert.equal(writesEnabled(), true);
    process.env.WRITES_ENABLED = "";
    assert.equal(writesEnabled(), false);
  });
});

describe("signupsEnabled: only the exact text \"true\" lets people sign up", () => {
  it("\"true\" is ON", () => {
    assert.equal(signupsEnabled({ SIGNUPS_ENABLED: "true" }), true);
  });

  const offValues: Array<[label: string, value: string | undefined]> = [
    ["capitals: \"TRUE\"", "TRUE"],
    ["a capital letter: \"True\"", "True"],
    ["\"1\"", "1"],
    ["\"yes\"", "yes"],
    ["a leading space: \" true\"", " true"],
    ["a trailing space: \"true \"", "true "],
    ["\"false\"", "false"],
    ["an empty string", ""],
    ["a missing setting", undefined],
  ];

  for (const [label, value] of offValues) {
    it(`${label} is OFF`, () => {
      assert.equal(signupsEnabled({ SIGNUPS_ENABLED: value }), false);
    });
  }

  it("settings with no SIGNUPS_ENABLED at all is OFF", () => {
    assert.equal(signupsEnabled({}), false);
  });

  it("is separate from the write switch: WRITES_ENABLED does not turn sign-up on", () => {
    assert.equal(signupsEnabled({ WRITES_ENABLED: "true" } as never), false);
  });
});
