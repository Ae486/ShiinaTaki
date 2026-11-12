import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryTransitionPreviewSchema, MemoryTransitionOverviewSchema } from "@taki/shared";
import { MemoryTransitionsCard } from "./memory-transitions-card.tsx";
import { INITIAL_TRANSITIONS } from "./memory-transitions-controller.ts";
import type { MemoryTransitionsView } from "./use-memory-transitions.ts";
const noop = async () => undefined;
const base: MemoryTransitionsView = { ...INITIAL_TRANSITIONS, loading: false, connectionReady: true,
  refresh: noop, openPreview: noop, confirm: noop, dismiss: () => undefined, cancel: noop };
const render = (patch: Partial<MemoryTransitionsView>) => renderToStaticMarkup(<MemoryTransitionsCard view={{ ...base, ...patch }} />);
const actions = [
  { kind: "transition.return-local", allowed: true, reason: null },
  { kind: "transition.reenter-hindsight", allowed: false, reason: "wrong-provider" },
  { kind: "transition.emergency-local", allowed: true, reason: null },
];
const status = () => MemoryTransitionOverviewSchema.parse({ provider: "hindsight", epochId: "owned", actions, entries: [], hasOlder: false });

describe("minimal transition card states", () => {
  it("renders last-good authority on disconnect/read error and locks all mutations", () => {
    const markup = render({ status: status(), connectionReady: false, error: "读取超时" });
    expect(markup).toContain("Hindsight"); expect(markup).toContain("不会自动重新提交"); expect(markup).toContain("读取超时");
    expect(markup.match(/disabled=""/g)).toHaveLength(4);
    expect(render({ loading: true })).toContain("animate-pulse");
    expect(render({ loading: true, connectionReady: false })).not.toContain("animate-pulse");
  });
  it.each([
    ["inventory-unreadable", "无法读取完整的本地证据清单。"],
    ["incomplete-replica", "本地副本或记忆策略证据不完整，无法接管。"],
  ])("shows the %s emergency blocker and never enables confirmation", (blocker, label) => {
    const preview = MemoryTransitionPreviewSchema.parse({ version: 2, kind: "transition.emergency-local", previewId: crypto.randomUUID(),
      previewHash: "a".repeat(64), expected: null, actorId: "operator", createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(),
      capabilityHash: null, recovery: null, takeover: "refused", inventory: "unreadable", banks: [], backupAgeSeconds: null,
      lastVerifiedBackupId: null, blocking: [blocker], offline: true, remoteHead: "unknown", remoteLoss: "unknown" });
    const markup = render({ status: status(), preview });
    expect(markup).toContain("没有已验证备份；仍可能存在"); expect(markup).toContain("游标相等也不能证明没有丢失");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认紧急接管<\/button>/);
    expect(markup).not.toContain("确认切换");
    expect(markup).toContain(label); expect(markup).not.toContain(blocker);
  });
  it("rejects contradictory permissions and undeclared refusal reasons at the Shared boundary", () => {
    expect(() => MemoryTransitionOverviewSchema.parse({ ...status(), actions: actions.map((a) => ({ ...a, reason: "private-error" })) })).toThrow();
    expect(() => MemoryTransitionOverviewSchema.parse({ ...status(), actions: [{ ...actions[0], reason: "busy" }, ...actions.slice(1)] })).toThrow();
  });
  it("does not send an initialized Local authority back through first onboarding", () => {
    const local = MemoryTransitionOverviewSchema.parse({ ...status(), provider: "local", actions: [
      { kind: "transition.return-local", allowed: false, reason: "wrong-provider" },
      { kind: "transition.reenter-hindsight", allowed: false, reason: "baseline" },
      { kind: "transition.emergency-local", allowed: false, reason: "wrong-provider" },
    ] });
    const markup = render({ status: local });
    expect(markup).toContain("当前已使用 Local，无需再次返回或紧急接管。");
    expect(markup).toContain("请检查初始化与历史转换记录");
    expect(markup).not.toContain("请使用下方启用流程");
    expect(markup).not.toContain("请使用首次启用流程");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(render({ status: status() })).toContain("当前已使用 Hindsight，无需重新进入。");
    expect(render({ status: { ...local, provider: null, epochId: null } })).toContain("尚未启用记忆权威，请使用下方启用流程。");
  });
});
