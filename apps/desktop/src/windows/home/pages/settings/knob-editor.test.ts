/**
 * INPUT:  config.list entries of every input kind + provenance combination (fixtures — no DOM).
 * OUTPUT: assertions that the editor descriptor follows the SERVER metadata (kind, disabled, secret masking) and that
 *         input parsing enforces the metadata's own numeric bounds before a round trip.
 * POS:    unit test for windows/home/pages/settings/knob-editor. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { ConfigEntry } from "@taki/shared";
import { editorFor, parseKnobInput } from "./knob-editor.ts";

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
    description: "",
    ...overrides,
  };
}

describe("editorFor", () => {
  it("maps each input kind to its editor", () => {
    const kinds = ["boolean", "int", "number", "string", "enum"] as const;

    for (const kind of kinds) expect(editorFor(entry({ input: { kind } })).kind).toBe(kind);
  });

  it("carries the enum options and the numeric bounds through from the metadata", () => {
    const enumEditor = editorFor(entry({ input: { kind: "enum", options: ["on", "off"] } }));
    const intEditor = editorFor(entry());

    expect(enumEditor.options).toEqual(["on", "off"]);
    expect([intEditor.min, intEditor.max]).toEqual([1, 50]);
  });

  it("disables an env-locked knob and names the reason", () => {
    const editor = editorFor(entry({ envLocked: true }));

    expect(editor.disabled).toBe(true);
    expect(editor.disabledReason).toContain("环境变量");
  });

  it("disables an env-only bootstrap knob", () => {
    expect(editorFor(entry({ apply: "env-only", input: { kind: "string" } })).disabled).toBe(true);
  });

  it("renders a secret as set/not-set ONLY — the value never appears", () => {
    const set = editorFor(entry({ secret: true, secretSet: true, value: null, input: { kind: "string" } }));
    const unset = editorFor(entry({ secret: true, secretSet: false, value: null, input: { kind: "string" } }));

    expect(set.kind).toBe("secret");
    expect(set.display).toBe("已设置");
    expect(unset.display).toBe("未设置");
    expect(set.disabled).toBe(true);
  });
});

describe("parseKnobInput", () => {
  it("passes booleans through and treats an empty string as a reset", () => {
    expect(parseKnobInput(entry({ input: { kind: "boolean" } }), true)).toEqual({ ok: true, value: true });
    expect(parseKnobInput(entry(), "  ")).toEqual({ ok: true, value: null });
  });

  it("parses numbers and refuses what the metadata's own bounds exclude", () => {
    expect(parseKnobInput(entry(), "12")).toEqual({ ok: true, value: 12 });
    expect(parseKnobInput(entry(), "1.5").ok).toBe(false);
    expect(parseKnobInput(entry(), "0").ok).toBe(false);
    expect(parseKnobInput(entry(), "51").ok).toBe(false);
    expect(parseKnobInput(entry(), "abc").ok).toBe(false);
    expect(parseKnobInput(entry({ input: { kind: "number", max: 1 } }), "0.7")).toEqual({ ok: true, value: 0.7 });
  });

  it("trims a string knob rather than storing the operator's whitespace", () => {
    expect(parseKnobInput(entry({ input: { kind: "string" } }), " taki ")).toEqual({ ok: true, value: "taki" });
  });
});
