import { describe, expect, it, vi } from "vitest";
import type { CacheUsageUpdate, ConfigChanged, LatestPrimaryRequestSnapshot } from "@taki/shared";
import { CacheUsageController, INITIAL_CACHE_USAGE_VIEW, type CacheUsageClient, type CacheUsageView } from "./cache-usage-controller.ts";

function update(revision = 5): CacheUsageUpdate {
  return { revision, snapshot: {
    scope: "all-observed-model-requests", characterId: "taki", summaryRevision: 6,
    summaryCommittedAt: "2026-11-01T10:00:00.000Z", boundary: "captured", status: "ready",
    computedAt: "2026-11-01T11:00:00.000Z", observedRequests: 4, pairedRequests: 2,
    inputTokens: 100, cacheReadTokens: 90, ratio: 0.9, reason: null,
  } };
}
function latest(characterId = "taki"): LatestPrimaryRequestSnapshot {
  return { scope: "latest-primary-request", characterId, status: "empty", reason: null, request: null,
    computedAt: "2026-11-02T11:00:00.000Z" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeClient() {
  const listeners = new Set<(value: CacheUsageUpdate) => void>();
  const modes = new Set<(value: ConfigChanged) => void>();
  const closes: Array<() => void> = [];
  const order: string[] = [];
  const client: CacheUsageClient = {
    subscribeCacheUsage: vi.fn(async () => { order.push("subscribe"); return update(); }),
    unsubscribeCacheUsage: vi.fn(async () => { order.push("unsubscribe"); }),
    onCacheUsageChanged: vi.fn((handler) => { order.push("handler"); listeners.add(handler); return () => { listeners.delete(handler); }; }),
    onConfigChanged: vi.fn((handler) => { modes.add(handler); return () => { modes.delete(handler); }; }),
    onClose: (handler) => { closes.push(handler); },
  };
  return { client, listeners, order,
    push: (value: CacheUsageUpdate) => [...listeners].forEach((handler) => handler(value)),
    mode: (value: ConfigChanged["value"]) => [...modes].forEach((handler) => handler({ key: "TAKI_MONITOR_MODE", value })),
    close: () => closes.forEach((handler) => handler()),
  };
}
function setup() {
  let view = INITIAL_CACHE_USAGE_VIEW;
  const publish = vi.fn((next: CacheUsageView) => { view = next; });
  const controller = new CacheUsageController(publish, "taki");
  const wire = fakeClient();
  controller.setEnabled(true);
  controller.bind(wire.client);
  return { ...wire, controller, publish, read: () => view };
}

describe("whole-window cache subscription lifecycle", () => {
  it("commits cache and latest request atomically, rejects late initial and clears unsupported legacy fields", async () => {
    const h = setup();
    h.push({ ...update(8), latestPrimaryRequest: latest() });
    await Promise.resolve();
    expect(h.read()).toMatchObject({ snapshot: update(8).snapshot, latestPrimaryRequest: latest() });
    expect(h.publish.mock.calls.at(-1)?.[0]).toMatchObject({ snapshot: update(8).snapshot, latestPrimaryRequest: latest() });
    h.push({ ...update(9), latestPrimaryRequest: latest("other") });
    expect(h.read().latestPrimaryRequest).toEqual(latest());
    h.push(update(10));
    expect(h.read().latestPrimaryRequest).toBeNull();
    h.controller.dispose();
  });

  it("preserves combined facts while disconnected and replaces them from the new process after hidden retirement", async () => {
    const h = setup(); await Promise.resolve();
    h.push({ ...update(100), latestPrimaryRequest: latest() });
    const old = [...h.listeners][0]!;
    h.controller.setVisible(false); old(update(101));
    h.controller.bind(null); h.controller.setVisible(true);
    expect(h.read()).toMatchObject({ phase: "stale", latestPrimaryRequest: latest() });
    const replacement = fakeClient();
    vi.mocked(replacement.client.subscribeCacheUsage).mockResolvedValue({ ...update(1), latestPrimaryRequest: { ...latest(), computedAt: "2026-11-02T12:00:00.000Z" } });
    h.controller.bind(replacement.client); await Promise.resolve();
    expect(h.read()).toMatchObject({ phase: "live", latestPrimaryRequest: { computedAt: "2026-11-02T12:00:00.000Z" } });
    old(update(102)); expect(h.read().latestPrimaryRequest?.computedAt).toBe("2026-11-02T12:00:00.000Z");
    h.controller.dispose();
  });
  it("registers before initial read and ignores a late older initial result after a push", async () => {
    const h = setup();
    expect(h.order).toEqual(["handler", "subscribe"]);
    h.push(update(8));
    await Promise.resolve();
    expect(h.read()).toMatchObject({ phase: "live", snapshot: update(8).snapshot });
    h.push({ ...update(7), snapshot: { ...update(7).snapshot, ratio: 0 } });
    expect(h.read().snapshot?.ratio).toBe(0.9);
    h.controller.dispose();
  });

  it("keeps the newest pushed snapshot when an older subscription attempt fails", async () => {
    const h = setup();
    await Promise.resolve();
    const pending = deferred<CacheUsageUpdate>();
    vi.mocked(h.client.subscribeCacheUsage).mockReturnValueOnce(pending.promise);
    h.controller.retry();
    h.push(update(9));
    pending.reject(new Error("read failed"));
    await Promise.resolve();
    expect(h.read()).toMatchObject({ phase: "live", error: null });
    h.controller.dispose();
  });

  it("joins deliberate retries during one pending read without replacing the current window", async () => {
    const h = setup(); await Promise.resolve();
    const pending = deferred<CacheUsageUpdate>();
    vi.mocked(h.client.subscribeCacheUsage).mockReturnValueOnce(pending.promise);
    h.controller.retry();
    h.controller.retry();
    expect(h.client.subscribeCacheUsage).toHaveBeenCalledTimes(2);
    expect(h.read()).toMatchObject({ phase: "refreshing", snapshot: update().snapshot });
    pending.resolve(update(6)); await Promise.resolve();
    expect(h.read().phase).toBe("live");
    h.controller.dispose();
  });

  it("replaces old-window data with empty and unknown snapshots after summary commits", async () => {
    const h = setup(); await Promise.resolve();
    h.push({ revision: 6, snapshot: { ...update().snapshot, summaryRevision: 7, status: "empty",
      observedRequests: 0, pairedRequests: 0, inputTokens: 0, cacheReadTokens: 0, ratio: null } });
    expect(h.read().snapshot).toMatchObject({ summaryRevision: 7, ratio: null, status: "empty" });
    h.push({ revision: 7, snapshot: { ...update().snapshot, summaryRevision: 8, status: "unavailable", boundary: null,
      observedRequests: null, pairedRequests: null, inputTokens: null, cacheReadTokens: null, ratio: null, reason: "read-failed" } });
    expect(h.read().snapshot).toMatchObject({ summaryRevision: 8, ratio: null, status: "unavailable" });
    h.controller.dispose();
  });

  it("retires hidden responses, suppresses hidden React publications and restores through a current subscription", async () => {
    const h = setup(); await Promise.resolve();
    const pending = deferred<CacheUsageUpdate>();
    vi.mocked(h.client.subscribeCacheUsage).mockReturnValueOnce(pending.promise);
    h.controller.retry();
    const retired = [...h.listeners][0]!;
    const count = h.publish.mock.calls.length;
    h.controller.setVisible(false);
    pending.resolve(update(10)); retired(update(11));
    await Promise.resolve();
    expect(h.publish).toHaveBeenCalledTimes(count);
    h.mode("DISABLED");
    expect(h.publish).toHaveBeenCalledTimes(count);
    h.controller.setVisible(true);
    expect(h.read()).toEqual(INITIAL_CACHE_USAGE_VIEW);
    expect(h.client.unsubscribeCacheUsage).toHaveBeenCalledTimes(2);
    h.mode("FEEDBACK_ONLY");
    h.push(update(12));
    expect(h.read().snapshot).toEqual(update(12).snapshot);
    h.controller.dispose();
  });

  it("preserves last-good data across disconnect and accepts a replacement process's lower revision", async () => {
    const h = setup(); await Promise.resolve();
    h.push(update(100));
    h.close();
    expect(h.read()).toMatchObject({ phase: "stale", snapshot: update().snapshot });
    const replacement = fakeClient();
    vi.mocked(replacement.client.subscribeCacheUsage).mockResolvedValue(update(1));
    h.controller.bind(replacement.client);
    h.close(); // late old-close notification cannot retire the new client
    await Promise.resolve();
    expect(h.read()).toMatchObject({ phase: "live", snapshot: update(1).snapshot });
    h.controller.dispose();
  });

  it("retains retryable failures, does no automatic retry and clears on live disable", async () => {
    const h = setup(); await Promise.resolve();
    vi.mocked(h.client.subscribeCacheUsage).mockRejectedValueOnce(new Error("private read failure"));
    h.controller.retry(); await Promise.resolve();
    expect(h.read()).toMatchObject({ phase: "error", error: "缓存统计读取失败", snapshot: update().snapshot });
    expect(h.client.subscribeCacheUsage).toHaveBeenCalledTimes(2);
    h.mode("DISABLED");
    expect(h.read()).toEqual(INITIAL_CACHE_USAGE_VIEW);
    h.controller.retry();
    expect(h.client.subscribeCacheUsage).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });

  it("ignores a wrong Character and late retired connection updates", async () => {
    const h = setup(); await Promise.resolve();
    const old = [...h.listeners][0]!;
    h.push({ ...update(10), snapshot: { ...update().snapshot, characterId: "other" } });
    expect(h.read().snapshot).toEqual(update().snapshot);
    h.controller.bind(null);
    old({ ...update(11), snapshot: { ...update().snapshot, ratio: 0 } });
    expect(h.read().snapshot?.ratio).toBe(0.9);
    h.controller.dispose();
  });

  it("does no read work while initially hidden or disabled", () => {
    const wire = fakeClient();
    const controller = new CacheUsageController(vi.fn(), "taki");
    controller.setVisible(false); controller.bind(wire.client); controller.setEnabled(true);
    expect(wire.client.subscribeCacheUsage).not.toHaveBeenCalled();
    controller.setEnabled(false); controller.setVisible(true);
    expect(wire.client.subscribeCacheUsage).not.toHaveBeenCalled();
    controller.dispose();
  });
});
