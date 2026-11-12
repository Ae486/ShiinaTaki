import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConfigEntry } from "@taki/shared";
import { KnobField } from "./knob-field.tsx";

const draft = vi.hoisted(() => ({
  state: { draft: "newer", baseline: "saved", latest: "saved", dirty: true,
    focused: true, composing: false, saving: false, error: null as string | null },
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
  onSave={onSave} />);

describe("Settings save-result wording", () => {
  beforeEach(() => { draft.state.dirty = true; draft.state.draft = "newer"; draft.state.error = null; draft.state.saving = false; });

  it("distinguishes a confirmed prior submission from the newer unsaved value still in the input", () => {
    const html = render();
    expect(html).toContain('value="newer"');
    expect(html).not.toContain("已保存 · 立即生效");
    expect(html).toContain("保存未保存的修改");
  });

  it("does not leave a successful-save banner in the matching clean field", () => {
    draft.state.dirty = false;
    draft.state.draft = "saved";
    const html = render();
    expect(html).not.toContain("已保存 · 立即生效");
    expect(html).not.toContain("当前修改尚未保存");
    expect(html).not.toContain("保存未保存的修改");
  });

  it("retains one actionable field error and keeps the save control present while pending", () => {
    draft.state.error = "无法写入配置";
    expect(render().match(/无法写入配置/g)).toHaveLength(1);
    draft.state.error = null;
    draft.state.saving = true;
    const html = render();
    expect(html).toContain("保存未保存的修改");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("保存中…");
  });
});
