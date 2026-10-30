import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { InitiativeWakePolicyStatus, InteractionPatternChanged } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { INITIAL_POLICY_STATE, InitiativePolicyController } from "./initiative-policy-controller.ts";
import { InitiativePolicyView } from "./initiative-policy-view.tsx";
import { deferred, setupStatus } from "./pattern-test-fixtures.ts";

const snapshot: InitiativeWakePolicyStatus = { characterId: "taki", cursor: 178923, since: "2026-09-28T10:00:00Z",
  recent: [{ occurredAt: "2026-09-28T10:01:00Z", source: "clock", reason: "quiet-hours", matchedCount: 1 }],
  counters: [{ reason: "quiet-hours", count: 3 }] };

function client() {
  const listeners = new Set<(event: InteractionPatternChanged) => void>();
  return {
    initiativeWakePolicy: vi.fn<WsClient["initiativeWakePolicy"]>(async () => snapshot),
    onInitiativeWakePolicyChanged: (listener: (event: InteractionPatternChanged) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    changed: () => listeners.forEach((listener) => listener({ characterId: "taki" })),
  };
}

describe("same-Monitor initiative policy", () => {
  it("does not fetch for a disabled/hidden Monitor and retains the last-good projection on failure", async () => {
    let state = INITIAL_POLICY_STATE;
    const controller = new InitiativePolicyController((next) => { state = next; }), source = client();
    controller.bind(source); source.changed();
    expect(source.initiativeWakePolicy).not.toHaveBeenCalled();
    controller.setActive(true); await controller.refresh();
    expect(state.data).toEqual(snapshot);
    source.initiativeWakePolicy.mockRejectedValueOnce(new Error("unsupported"));
    await controller.refresh(); expect(state.stale).toBe(true); expect(state.error).toContain("尚不支持");
    expect(state.data).toEqual(snapshot);
    controller.setActive(false); source.changed(); expect(source.initiativeWakePolicy).toHaveBeenCalledTimes(2);
  });

  it("drops old-client answers across reconnect and only accepts actual replacement evidence", async () => {
    let state = INITIAL_POLICY_STATE;
    const controller = new InitiativePolicyController((next) => { state = next; });
    const first = client(), slow = deferred<InitiativeWakePolicyStatus>();
    first.initiativeWakePolicy.mockReturnValueOnce(slow.promise);
    controller.setActive(true); controller.bind(first);
    const next = client(); next.initiativeWakePolicy.mockResolvedValue({ ...snapshot, counters: [{ reason: "busy", count: 7 }] });
    controller.bind(next); await controller.refresh();
    slow.resolve(snapshot); await Promise.resolve();
    expect(state.data?.counters).toEqual([{ reason: "busy", count: 7 }]);
  });

  it("shows unavailable values as unknown and converts real global timing units", () => {
    const data = setupStatus();
    expect(renderToStaticMarkup(<InitiativePolicyView setup={data} />)).toContain("主动互动：未知");
    data.settings.push({ key: "TAKI_INITIATIVE_UTTERANCE_GAP_MS", value: 600000, default: 600000, stored: false,
      envLocked: false, apply: "live", secret: false, secretSet: false, input: { kind: "int" }, description: "gap" });
    const markup = renderToStaticMarkup(<InitiativePolicyView setup={data} />);
    expect(markup).toContain("10 分钟"); expect(markup).not.toContain("600000");
    expect(markup).not.toContain("TAKI_INITIATIVE_UTTERANCE_GAP_MS");
    expect(markup).toContain("定时检查：未知"); expect(markup).toContain("事件检查：未知");
  });

  it.each([[true, false], [false, true], [false, false]])("discloses actual periodic=%s/event=%s scope beside candidate review limits", (periodic, events) => {
    const data = setupStatus();
    for (const [key, value] of [["TAKI_INITIATIVE_PERIODIC_ENABLED", periodic],
      ["TAKI_INITIATIVE_EVENTS_ENABLED", events], ["TAKI_INITIATIVE_CHECK_INTERVAL_MS", 60000]] as const) {
      data.settings.push({ key, value, default: value, stored: false, envLocked: false, apply: "live",
        secret: false, secretSet: false, input: { kind: typeof value === "boolean" ? "boolean" : "int" }, description: "wake setting" });
    }
    const markup = renderToStaticMarkup(<InitiativePolicyView setup={data} />);
    expect(markup).toContain(`定时检查：${periodic ? "开启" : "关闭"}`);
    expect(markup).toContain(`事件检查：${events ? "开启" : "关闭"}`);
    expect(markup).toContain("60 秒");
    expect(markup).toContain("两者都关闭时不启动新的主动互动");
    expect(markup).toContain("两种检查都必须满足规则");
    expect(markup).not.toContain("TAKI_INITIATIVE_");
  });
});
