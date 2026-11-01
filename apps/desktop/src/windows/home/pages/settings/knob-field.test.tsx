import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConfigEntry } from "@taki/shared";
import { KnobField } from "./knob-field.tsx";
import { configLabelOf } from "./config-groups.ts";
import { editorFor, parseKnobInput } from "./knob-editor.ts";

const noop = async () => ({ kind: "saved" as const, display: "gpt-x", current: true });

function entry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return {
    key: "TAKI_PROVIDER_MODEL",
    value: "gpt-x",
    stored: true,
    envLocked: false,
    default: null,
    apply: "restart",
    secret: false,
    secretSet: false,
    input: { kind: "string" },
    description: "Main chat model id.",
    ...overrides,
  };
}

function render(entry_: ConfigEntry, chineseLabel?: string): string {
  return renderToStaticMarkup(
    <KnobField entry={entry_} chineseLabel={chineseLabel} connectionReady={true} onSave={noop} />,
  );
}

describe("KnobField label hierarchy (U7)", () => {
  it("renders registered N/K numeric controls and the next-interval guidance without a new editor", () => {
    for (const [key, value, min] of [["TAKI_SUBAGENT_CHECKIN_STEPS", 50, 1], ["TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS", 0, 0]] as const) {
      const knob = entry({ key, value, default: value, apply: "live", input: { kind: "int", min } });
      const html = render(knob, configLabelOf(key) ?? undefined);
      expect(html).toContain('type="number"'); expect(editorFor(knob).min).toBe(min);
      expect(html).toContain(`aria-label="${key}"`); expect(html).toContain(`value="${value}"`);
      expect(html).toContain("下一个进度检查间隔"); expect(html).not.toContain("重启生效");
      expect(parseKnobInput(knob, String(value))).toEqual({ ok: true, value });
      expect(parseKnobInput(knob, String(min - 1))).toEqual({ ok: false, message: `不得小于 ${min}` });
    }
  });
  it("shows the Chinese label primary with the raw key as a secondary code line when mapped", () => {
    const html = render(entry(), "主模型 ID");
    expect(html).toContain("主模型 ID");
    expect(html).toContain("TAKI_PROVIDER_MODEL");
    expect(html.indexOf("主模型 ID")).toBeLessThan(html.indexOf("TAKI_PROVIDER_MODEL"));
    expect(html).toContain("Main chat model id.");
  });

  it("keeps the raw key primary for unknown keys (safe fallback)", () => {
    const html = render(entry({ key: "TAKI_FUTURE_KNOB" }));
    expect(html).toContain("TAKI_FUTURE_KNOB");
    expect(html).not.toContain("主模型 ID");
  });
});
