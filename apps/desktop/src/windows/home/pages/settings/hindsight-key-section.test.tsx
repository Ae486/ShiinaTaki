import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HindsightKeyForm } from "./hindsight-key-section.tsx";
import { HINDSIGHT_KEY_REF, INITIAL_KEY_STATE } from "./hindsight-key-controller.ts";
import type { useHindsightKey } from "./use-hindsight-key.ts";

const noop = async () => undefined;
type View = ReturnType<typeof useHindsightKey>;
const view = (patch: Partial<View> = {}): View => ({
  state: { ...INITIAL_KEY_STATE, loading: false, presence: { secretRef: HINDSIGHT_KEY_REF, present: false, health: "ok", provenance: null } },
  connectionReady: true, value: "", edit: () => undefined, save: noop, clear: noop, refresh: noop, ...patch,
});
const render = (data: View) => renderToStaticMarkup(<HindsightKeyForm view={data} />);

describe("Hindsight key form", () => {
  it("offers a labelled password input and distinct save/clear actions for first use", () => {
    const markup = render(view());
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain("尚未保存 API Key");
    expect(markup).toContain("保存 API Key");
    expect(markup).toContain("清除 API Key");
    expect(markup).toContain("完成后到操作页校验连接");
    const fieldId = markup.match(/<label for="([^"]+)"[^>]*>Hindsight API Key<\/label>/)?.[1];
    expect(fieldId).toBeDefined();
    expect(markup).toContain(`id="${fieldId}"`);
  });

  it("offers replacement for a stored key without returning its value or claiming connection validity", () => {
    const data = view();
    data.state.presence = { secretRef: HINDSIGHT_KEY_REF, present: true, health: "ok", provenance: null };
    const markup = render(data);
    expect(markup).toContain("替换 API Key");
    expect(markup).toContain("连接校验结果请查看操作页");
    expect(markup).toContain('value=""');
  });

  it("renders locked presence as unknown and disables editing and mutations", () => {
    const data = view();
    data.state.presence = { secretRef: HINDSIGHT_KEY_REF, present: false, health: "locked", provenance: null };
    const markup = render(data);
    expect(markup).toContain("密钥存储已锁定，保存状态未知");
    expect(markup).not.toContain("尚未保存 API Key");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("retains unknown/offline/read-error distinctions and provides refresh recovery", () => {
    const offline = render(view({ connectionReady: false }));
    expect(offline).toContain("连接恢复后将重新读取密钥状态");
    expect(offline.match(/disabled=""/g)).toHaveLength(4);
    const failed = render(view({ state: { presence: null, loading: false, busy: null,
      feedback: { tone: "danger", message: "无法读取 API Key 状态" } } }));
    expect(failed).toContain("保存状态未知");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("刷新密钥状态");
  });
});
