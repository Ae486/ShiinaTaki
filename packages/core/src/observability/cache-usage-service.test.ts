import { describe, expect, it, vi } from "vitest";
import { CACHE_USAGE_METHODS, type CacheUsageUpdate, type CacheUsageWindowSnapshot, type MonitorMode } from "@taki/shared";
import type { LatestPrimaryRequestSnapshot } from "@taki/shared";
import { createCacheUsageService } from "./cache-usage-service.ts";
import { registerCacheUsageMethods } from "../server/methods/cache-usage-methods.ts";
import { createMethodRegistry, type MethodContext } from "../server/method-registry.ts";
import type { Connection } from "../server/connection-registry.ts";

const at = "2026-11-01T13:00:00.000Z";
const snapshot: CacheUsageWindowSnapshot = { scope: "all-observed-model-requests", characterId: "taki",
  summaryRevision: 0, summaryCommittedAt: null, boundary: "before-first-summary", status: "ready", computedAt: at,
  observedRequests: 2, pairedRequests: 1, inputTokens: 100, cacheReadTokens: 50, ratio: 0.5, reason: null };
const connection = (): Connection => ({ state: { status: "authenticated", role: "operator", deviceId: "test", capabilities: [] } });

function fixture() {
  let mode: MonitorMode = "FULL_LOCAL";
  const read = vi.fn((characterId: string) => ({ ...snapshot, characterId }));
  const warn = vi.fn();
  const service = createCacheUsageService({ read, mode: () => mode, logger: { warn } });
  return { service, read, warn, setMode(value: MonitorMode) { mode = value; } };
}

describe("computed cache usage subscriptions", () => {
  it("preserves the independent latest-primary sibling in initial and explicit pushed payloads", async () => {
    const latest: LatestPrimaryRequestSnapshot = { scope: "latest-primary-request", characterId: "taki", status: "empty",
      computedAt: at, reason: null, request: null };
    const readLatestPrimaryRequest = vi.fn(() => latest);
    const service = createCacheUsageService({ read: () => snapshot, readLatestPrimaryRequest,
      mode: () => "FULL_LOCAL", logger: { warn: vi.fn() } });
    const updates: CacheUsageUpdate[] = [];
    expect(service.subscribe(connection(), "taki", (update) => updates.push(update)).update.latestPrimaryRequest).toEqual(latest);
    service.changed(); service.changed(); await Promise.resolve();
    expect(updates[0]?.latestPrimaryRequest).toEqual(latest);
    expect(updates[0]?.snapshot).toEqual(snapshot);
    expect(readLatestPrimaryRequest).toHaveBeenCalledTimes(2);
  });
  it("isolates attribution and cache read failures and per-observer payload mutations", async () => {
    const latest: LatestPrimaryRequestSnapshot = { scope: "latest-primary-request", characterId: "taki", status: "empty",
      computedAt: at, reason: null, request: null };
    const read = vi.fn(() => snapshot); const readLatestPrimaryRequest = vi.fn(() => latest);
    const service = createCacheUsageService({ read, readLatestPrimaryRequest, mode: () => "FULL_LOCAL", logger: { warn: vi.fn() } });
    const updates: CacheUsageUpdate[] = [];
    service.subscribe(connection(), "taki", (update) => { if (update.latestPrimaryRequest) update.latestPrimaryRequest.reason = "read-failed"; });
    service.subscribe(connection(), "taki", (update) => updates.push(update));
    service.changed(); await Promise.resolve();
    expect(updates[0]?.latestPrimaryRequest?.reason).toBeNull();
    readLatestPrimaryRequest.mockImplementation(() => { throw new Error("private attribution detail"); });
    service.changed(); await Promise.resolve();
    expect(updates[1]).toMatchObject({ snapshot, latestPrimaryRequest: { status: "unavailable", reason: "read-failed" } });
    readLatestPrimaryRequest.mockReturnValue(latest); read.mockImplementation(() => { throw new Error("private cache detail"); });
    service.changed(); await Promise.resolve();
    expect(updates[2]).toMatchObject({ snapshot: { status: "unavailable" }, latestPrimaryRequest: latest });
    expect(JSON.stringify(updates)).not.toContain("private");
  });
  it("withdraws both independent projections on mode disable without reading either authority", async () => {
    let mode: MonitorMode = "FULL_LOCAL";
    const read = vi.fn(() => snapshot);
    const readLatestPrimaryRequest = vi.fn((): LatestPrimaryRequestSnapshot => ({ scope: "latest-primary-request",
      characterId: "taki", status: "empty", computedAt: at, reason: null, request: null }));
    const service = createCacheUsageService({ read, readLatestPrimaryRequest, mode: () => mode, logger: { warn: vi.fn() } });
    const updates: CacheUsageUpdate[] = []; service.subscribe(connection(), "taki", (update) => updates.push(update));
    read.mockClear(); readLatestPrimaryRequest.mockClear(); mode = "DISABLED"; service.changed(); await Promise.resolve();
    expect(read).not.toHaveBeenCalled(); expect(readLatestPrimaryRequest).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ snapshot: { reason: "monitor-disabled" }, latestPrimaryRequest: { reason: "monitor-disabled" } });
  });
  it("does no aggregate work without an observer and returns an initial snapshot", async () => {
    const f = fixture(); f.service.changed(); await Promise.resolve();
    expect(f.read).not.toHaveBeenCalled();
    const initial = f.service.subscribe(connection(), "taki", () => undefined);
    expect(initial).toMatchObject({ added: true, update: { revision: 1, snapshot } });
    expect(f.read).toHaveBeenCalledTimes(1);
  });
  it("coalesces a committed burst and shares one read per scope, with independent delivery", async () => {
    const f = fixture(); const updates: CacheUsageUpdate[] = [];
    f.service.subscribe(connection(), "taki", () => { throw new Error("closed socket"); });
    f.service.subscribe(connection(), "taki", (update) => updates.push(update));
    f.service.subscribe(connection(), "other", (update) => updates.push(update));
    f.read.mockClear(); f.service.changed(); f.service.changed(); await Promise.resolve();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(updates.map((update) => update.snapshot.characterId)).toEqual(["taki", "other"]);
  });
  it("replaces one connection membership and a fresh read outranks queued older state", async () => {
    const f = fixture(); const conn = connection(); const old = vi.fn(); const fresh = vi.fn();
    const initial = f.service.subscribe(conn, "taki", old);
    f.service.changed();
    const replaced = f.service.subscribe(conn, "other", fresh);
    expect(replaced.added).toBe(false);
    expect(replaced.update.revision).toBeGreaterThan(initial.update.revision);
    await Promise.resolve(); expect(old).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledWith(expect.objectContaining({ snapshot: expect.objectContaining({ characterId: "other" }) }));
  });
  it("publishes a ready-to-empty reset and does not increment a local UI accumulator", async () => {
    const f = fixture(); const updates: CacheUsageUpdate[] = [];
    f.service.subscribe(connection(), "taki", (update) => updates.push(update));
    f.read.mockReturnValue({ ...snapshot, summaryRevision: 1, summaryCommittedAt: at, boundary: "captured",
      status: "empty", observedRequests: 0, pairedRequests: 0, inputTokens: 0, cacheReadTokens: 0, ratio: null });
    f.service.changed(); await Promise.resolve(); f.service.changed(); await Promise.resolve();
    expect(updates.map((update) => update.snapshot)).toEqual([f.read.mock.results[1]!.value, f.read.mock.results[2]!.value]);
    expect(updates[1]!.revision).toBeGreaterThan(updates[0]!.revision);
  });
  it("contains failed readers and loggers and exposes unknown instead of zero", async () => {
    const f = fixture(); const updates: CacheUsageUpdate[] = [];
    f.service.subscribe(connection(), "taki", (update) => updates.push(update));
    f.read.mockImplementation(() => { throw new Error("private database detail"); });
    f.warn.mockImplementation(() => { throw new Error("logger failure"); });
    f.service.changed(); await Promise.resolve();
    expect(updates[0]!.snapshot).toMatchObject({ status: "unavailable", inputTokens: null, ratio: null, reason: "read-failed" });
    expect(JSON.stringify(updates)).not.toContain("private database detail");
  });
  it("withdraws counts when disabled and refuses new disabled/unauthenticated subscriptions", async () => {
    const f = fixture(); const updates: CacheUsageUpdate[] = [];
    f.service.subscribe(connection(), "taki", (update) => updates.push(update)); f.read.mockClear();
    f.setMode("DISABLED"); f.service.changed(); await Promise.resolve();
    expect(f.read).not.toHaveBeenCalled();
    expect(updates[0]!.snapshot).toMatchObject({ reason: "monitor-disabled", ratio: null });
    expect(() => f.service.subscribe(connection(), "taki", () => undefined)).toThrow("OBSERVABILITY_DISABLED");
    expect(() => f.service.subscribe({ state: { status: "awaiting" } }, "taki", () => undefined)).toThrow("OBSERVABILITY_FORBIDDEN");
  });
  it("retired/disposed subscriptions perform no pending aggregate work", async () => {
    const f = fixture(); const conn = connection(); const notify = vi.fn();
    f.service.subscribe(conn, "taki", notify); f.read.mockClear(); f.service.changed(); f.service.unsubscribe(conn);
    await Promise.resolve(); expect(f.read).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    f.service.subscribe(conn, "taki", notify); f.read.mockClear(); f.service.changed(); f.service.dispose();
    await Promise.resolve(); expect(f.read).not.toHaveBeenCalled();
  });
});

describe("cache usage operator methods", () => {
  it("returns initial data, pushes later snapshots, and closes one replaced connection membership", async () => {
    const f = fixture(); const registry = createMethodRegistry(); registerCacheUsageMethods(registry, f.service);
    const cleanups: Array<() => void> = []; const notify = vi.fn();
    const ctx: MethodContext = { connection: connection(), notify, onClose: (close) => cleanups.push(close), close: () => undefined };
    const request = { jsonrpc: "2.0" as const, id: 1, method: CACHE_USAGE_METHODS.subscribe, params: { characterId: "taki" } };
    expect(await registry.dispatch(request, ctx)).toMatchObject({ result: { snapshot } });
    await registry.dispatch({ ...request, id: 2 }, ctx); expect(cleanups).toHaveLength(1);
    f.service.changed(); await Promise.resolve(); expect(notify).toHaveBeenCalledWith(CACHE_USAGE_METHODS.changed, expect.objectContaining({ snapshot }));
    cleanups[0]!(); notify.mockClear(); f.service.changed(); await Promise.resolve(); expect(notify).not.toHaveBeenCalled();
  });
  it("rejects invalid scopes and unauthorized roles through the real registry", async () => {
    const f = fixture(); const registry = createMethodRegistry(); registerCacheUsageMethods(registry, f.service);
    const ctx: MethodContext = { connection: connection(), notify: () => undefined, onClose: () => undefined, close: () => undefined };
    const request = { jsonrpc: "2.0" as const, id: 1, method: CACHE_USAGE_METHODS.subscribe, params: { characterId: "../private" } };
    expect(await registry.dispatch(request, ctx)).toHaveProperty("error");
    ctx.connection.state = { status: "awaiting" };
    expect(await registry.dispatch({ ...request, params: { characterId: "taki" } }, ctx)).toHaveProperty("error");
    expect(f.read).not.toHaveBeenCalled();
  });
});
