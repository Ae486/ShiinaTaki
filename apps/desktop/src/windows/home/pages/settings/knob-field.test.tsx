import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConfigEntry } from "@taki/shared";
import { KnobField } from "./knob-field.tsx";

const noop = () => undefined;

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
    <KnobField entry={entry_} chineseLabel={chineseLabel} connectionReady={true} notice={undefined} onSave={noop} />,
  );
}

describe("KnobField label hierarchy (U7)", () => {
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
