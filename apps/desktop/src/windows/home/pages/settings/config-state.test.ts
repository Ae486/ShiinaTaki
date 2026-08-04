/**
 * INPUT:  config.list entries, config.set outcomes and config.changed pushes (fixtures — no DOM, no socket).
 * OUTPUT: assertions for the knob-list transitions and the five-reason refusal vocabulary the page renders.
 * POS:    unit test for windows/home/pages/settings/config-state. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { ConfigRefusalReasonSchema, type ConfigEntry } from "@taki/shared";
import { applyChanged, applyStored, applyVerdict, refusalMessage, refusalOf } from "./config-state.ts";

function entry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return {
    key: "TAKI_MAX_STEPS",
    value: 10,
    stored: false,
    envLocked: false,
    default: 10,
    apply: "restart",
    secret: false,
    secretSet: false,
    input: { kind: "int", min: 1, max: 50 },
    description: "Tool-loop step cap per turn.",
    ...overrides,
  };
}

describe("config-state", () => {
  it("applies a config.changed push to the one key it names, leaving the rest untouched", () => {
    const entries = [entry(), entry({ key: "TAKI_LOG_LEVEL", value: "info", default: "info", input: { kind: "enum", options: ["info", "debug"] } })];

    const next = applyChanged(entries, { key: "TAKI_MAX_STEPS", value: 20 });

    expect(next[0]).toMatchObject({ value: 20, stored: true });
    expect(next[1]).toBe(entries[1]);
  });

  it("treats a null pushed value as a reset back to the built-in default", () => {
    const next = applyChanged([entry({ value: 20, stored: true })], { key: "TAKI_MAX_STEPS", value: null });

    expect(next[0]).toMatchObject({ value: 10, stored: false });
  });

  it("never lets a push move an env-locked or secret row (the server value still wins)", () => {
    const locked = [entry({ envLocked: true }), entry({ key: "TAKI_PROVIDER_API_KEY", secret: true, value: null })];

    const next = applyChanged(locked, { key: "TAKI_MAX_STEPS", value: 20 });
    const secret = applyChanged(locked, { key: "TAKI_PROVIDER_API_KEY", value: "leaked" });

    expect(next[0]).toBe(locked[0]);
    expect(secret[1]).toBe(locked[1]);
  });

  it("echoes an accepted config.set into the row", () => {
    const next = applyStored([entry()], { status: "ok", key: "TAKI_MAX_STEPS", value: 25, apply: "restart" });

    expect(next[0]).toMatchObject({ value: 25, stored: true });
  });

  it("maps every refusal reason to its own readable message", () => {
    const messages = ConfigRefusalReasonSchema.options.map((reason) => refusalMessage(reason));

    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(ConfigRefusalReasonSchema.options.length);
  });

  it("reads the machine-readable reason off a rejected set, and null off anything else", () => {
    expect(refusalOf({ data: { code: "CONFIG_REFUSED", reason: "env-locked" } })).toBe("env-locked");
    expect(refusalOf({ data: { code: "CONFIG_REFUSED", reason: "not-a-reason" } })).toBeNull();
    expect(refusalOf(new Error("socket closed"))).toBeNull();
  });

  it("states the apply verdict truthfully for each class", () => {
    expect(applyVerdict("live")).toContain("立即");
    expect(applyVerdict("restart")).toContain("重启");
    expect(applyVerdict("env-only")).toContain("环境变量");
  });
});
