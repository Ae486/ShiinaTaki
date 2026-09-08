import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConfigEntry } from "@taki/shared";
import { KnobField } from "./knob-field.tsx";

const draft = vi.hoisted(() => ({
  state: { draft: "newer", baseline: "saved", latest: "saved", dirty: true,
    focused: true, composing: false, saving: false, error: null },
  events: { change: vi.fn(), focus: vi.fn(), blur: vi.fn(), compositionStart: vi.fn(), compositionEnd: vi.fn(), commit: vi.fn() },
  conflicted: false, useLatest: vi.fn(), save: vi.fn(),
}));

vi.mock("./use-knob-draft.ts", () => ({ useKnobDraft: () => draft }));

const entry: ConfigEntry = {
  key: "TAKI_PROVIDER_MODEL", value: "saved", stored: true, envLocked: false, default: null,
  apply: "live", secret: false, secretSet: false, input: { kind: "string" }, description: "Model",
};
const onSave = async () => ({ kind: "saved" as const, display: "saved", current: true });
const render = () => renderToStaticMarkup(<KnobField entry={entry} connectionReady={true}
  notice={{ ok: true, message: "已保存 · 立即生效" }} onSave={onSave} />);

describe("Settings save-result wording", () => {
  beforeEach(() => { draft.state.dirty = true; draft.state.draft = "newer"; });

  it("distinguishes a confirmed prior submission from the newer unsaved value still in the input", () => {
    const html = render();
    expect(html).toContain('value="newer"');
    expect(html).toContain("上次提交：已保存 · 立即生效；当前修改尚未保存。");
    expect(html).toContain("保存未保存的修改");
  });

  it("retains the ordinary successful-save wording for the matching clean draft", () => {
    draft.state.dirty = false;
    draft.state.draft = "saved";
    const html = render();
    expect(html).toContain("已保存 · 立即生效");
    expect(html).not.toContain("当前修改尚未保存");
    expect(html).not.toContain("保存未保存的修改");
  });
});
