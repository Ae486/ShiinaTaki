import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_PLAYBACK_FRESH_MS, type BrowserPlaybackReport, type HostCatalogPublishParams } from "@taki/shared";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createMethodRegistry } from "../server/method-registry.ts";
import { registerBrowserPlaybackMethods } from "../server/methods/browser-playback-methods.ts";
import { createBrowserPlaybackSources } from "./browser-playback-sources.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  const connections = createConnectionRegistry(); const catalogs = createHostCatalogStore();
  const deviceId = randomUUID(); const connection = connections.create();
  const identity = { deviceId, role: "node" as const, capabilities: [], host: { protocolVersion: 3, catalogSchemaVersion: 2 } };
  const provenance = connections.authenticate(connection, identity)!;
  const catalog: HostCatalogPublishParams = { ...provenance, label: "test Shell", catalogGeneration: 1,
    publishedAt: new Date().toISOString(), readiness: "ready", capabilities: [], workspaces: [], skills: [], mcpServers: [] };
  catalogs.publish(catalog, provenance);
  const flags = { enabled: true }; const onChanged = vi.fn();
  const sources = createBrowserPlaybackSources({ connections, catalogs, enabled: () => flags.enabled, onChanged });
  cleanup.push(sources.close);
  const report = { kind: "sample", schemaVersion: "taki.browser-playback.v1", attachmentId: randomUUID(),
    attachmentGeneration: 1, catalogGeneration: 1, sequence: 1, observedAgeMs: 0,
    source: { tabId: 1, frameId: 0, documentId: randomUUID(), playerId: randomUUID(),
      media: { kind: "bilibili", bvid: "BV1UEaq6qEZt", cid: "42265479965", page: 1 } },
    sample: { state: "playing", positionSeconds: 20, durationSeconds: 299.3, playbackRate: 1,
      visible: true, pictureInPicture: false } } satisfies BrowserPlaybackReport;
  return { connections, catalogs, connection, identity, provenance, catalog, flags, sources, onChanged, report };
}

describe("authenticated browser playback sources", () => {
  it("retains an actual Chromium document token and refuses a replacement under the old attachment", () => {
    const f = fixture(); const report = { ...f.report, source: { ...f.report.source, documentId: "65AC7F3F61AF6FF1EA1451137F00A91B" } };
    expect(f.sources.report(f.connection, report)).toEqual({ accepted: true });
    expect(f.sources.read().sources[0]!.source.documentId).toBe(report.source.documentId);
    expect(f.sources.report(f.connection, { ...report, sequence: 2,
      source: { ...report.source, documentId: "75AC7F3F61AF6FF1EA1451137F00A91B" } })).toMatchObject({ accepted: false });
    expect(f.sources.read().sources).toEqual([]);
  });
  it("pushes privacy changes only to ready current Nodes and retires the source before notifying", async () => {
    const f = fixture(); const registry = createMethodRegistry();
    const methods = registerBrowserPlaybackMethods(registry, f); cleanup.push(methods.close);
    const observed: unknown[] = [];
    const notify = vi.fn((method, value) => {
      observed.push({ method, value, sources: f.sources.read().sources.length });
    });
    f.connection.notify = notify;
    const context = { connection: f.connection, notify: vi.fn(), close: vi.fn(), onClose: vi.fn() };
    methods.refresh(); expect(notify).not.toHaveBeenCalled();
    const ready = await registry.dispatch({ jsonrpc: "2.0", id: "ready", method: "browser.playback.ready",
      params: { schemaVersion: "taki.browser-playback.v1" } }, context);
    expect(ready).toMatchObject({ result: { revision: 1, enabled: true } });
    f.sources.report(f.connection, f.report);
    f.flags.enabled = false; methods.refresh(); methods.refresh();
    expect(observed).toEqual([{ method: "browser.playback.control",
      value: expect.objectContaining({ revision: 2, enabled: false, hostId: f.identity.deviceId }), sources: 0 }]);
    f.flags.enabled = true; methods.refresh();
    expect(notify).toHaveBeenLastCalledWith("browser.playback.control", expect.objectContaining({ revision: 3, enabled: true }));
    expect(f.sources.report(f.connection, { ...f.report, sequence: 2 })).toMatchObject({ accepted: false, reason: "stale_source" });
    f.connections.remove(f.connection); f.flags.enabled = false; methods.refresh();
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("updates catalog control bindings and requires a fresh source after catalog replacement", async () => {
    const f = fixture(); const registry = createMethodRegistry(); const methods = registerBrowserPlaybackMethods(registry, f);
    cleanup.push(methods.close); const notify = vi.fn(); f.connection.notify = notify;
    await registry.dispatch({ jsonrpc: "2.0", id: "ready", method: "browser.playback.ready",
      params: { schemaVersion: "taki.browser-playback.v1" } },
    { connection: f.connection, notify: vi.fn(), close: vi.fn(), onClose: vi.fn() });
    f.sources.report(f.connection, f.report);
    f.catalogs.publish({ ...f.catalog, catalogGeneration: 2 }, f.provenance); methods.refresh();
    expect(notify).toHaveBeenLastCalledWith("browser.playback.control", expect.objectContaining({ revision: 2, catalogGeneration: 2 }));
    expect(f.sources.read().sources).toEqual([]);
    expect(f.sources.report(f.connection, { ...f.report, sequence: 2, catalogGeneration: 2 })).toMatchObject({ accepted: false });
    expect(f.sources.report(f.connection, { ...f.report, catalogGeneration: 2,
      attachmentGeneration: 2, attachmentId: randomUUID() })).toEqual({ accepted: true });
  });
  it("derives Host provenance from the current socket and protects retained snapshots from caller mutation", () => {
    const f = fixture(); expect(f.sources.report(f.connection, f.report)).toEqual({ accepted: true });
    const first = f.sources.read().sources[0]!;
    expect(first).toMatchObject({ hostId: f.identity.deviceId, connectionGeneration: 1, catalogGeneration: 1 });
    first.sample.positionSeconds = 250; f.report.source.media.page = 2;
    expect(f.sources.resolve(first.sourceRef)).toMatchObject({ sample: { positionSeconds: 20 }, source: { media: { page: 1 } } });
  });
  it("requires opt-in and a current ready Host catalog", () => {
    const f = fixture(); f.flags.enabled = false;
    expect(f.sources.report(f.connection, f.report)).toEqual({ accepted: false, reason: "disabled" });
    f.flags.enabled = true; f.catalogs.retire(f.identity.deviceId, 1);
    expect(f.sources.report(f.connection, f.report)).toEqual({ accepted: false, reason: "wrong_host" });
  });
  it("rejects unauthenticated/operator collectors and replaced Node sockets", () => {
    const f = fixture(); const other = f.connections.create();
    expect(f.sources.report(other, f.report)).toMatchObject({ accepted: false });
    f.connections.authenticate(other, { deviceId: randomUUID(), role: "operator", capabilities: [] });
    expect(f.sources.report(other, f.report)).toMatchObject({ accepted: false });
    f.sources.report(f.connection, f.report);
    f.connections.authenticate(f.connections.create(), f.identity);
    expect(f.sources.read().sources).toEqual([]);
    expect(f.sources.report(f.connection, { ...f.report, sequence: 2 })).toMatchObject({ accepted: false });
  });
  it("rejects duplicate/reversed sequences without renewing freshness or discarding a valid newer sample", () => {
    const f = fixture(); f.sources.report(f.connection, f.report);
    f.sources.report(f.connection, { ...f.report, sequence: 3 });
    const before = f.sources.read(); vi.advanceTimersByTime(1000);
    for (const sequence of [1, 2, 3]) expect(f.sources.report(f.connection, { ...f.report, sequence }))
      .toEqual({ accepted: false, reason: "duplicate" });
    expect(f.sources.read()).toEqual(before);
  });
  it.each(["tab", "document", "player", "part"])("retires a %s replacement under the same attachment", (kind) => {
    const f = fixture(); f.sources.report(f.connection, f.report);
    const source = structuredClone(f.report.source);
    if (kind === "tab") source.tabId = 2;
    if (kind === "document") source.documentId = randomUUID();
    if (kind === "player") source.playerId = randomUUID();
    if (kind === "part") source.media = { ...source.media, page: 2, cid: "999" };
    expect(f.sources.report(f.connection, { ...f.report, sequence: 2, source })).toMatchObject({ accepted: false });
    expect(f.sources.read().sources).toEqual([]);
    expect(f.sources.report(f.connection, { ...f.report, sequence: 3 })).toMatchObject({ accepted: false });
  });
  it("requires a new source reference after retirement and rejects the old attachment's late frames", () => {
    const f = fixture(); f.sources.report(f.connection, f.report); const oldRef = f.sources.read().sources[0]!.sourceRef;
    const next = { ...f.report, attachmentId: randomUUID(), attachmentGeneration: 2 };
    expect(f.sources.report(f.connection, next)).toEqual({ accepted: true });
    const nextRef = f.sources.read().sources[0]!.sourceRef;
    expect(nextRef).not.toBe(oldRef); expect(f.sources.resolve(oldRef)).toBeUndefined();
    expect(f.sources.report(f.connection, { ...f.report, sequence: 99 })).toEqual({ accepted: false, reason: "stale_generation" });
    expect(f.sources.read().sources[0]!.sourceRef).toBe(nextRef);
  });
  it("expires by reception age with a proactive timer and refuses late renewal", () => {
    const f = fixture(); f.sources.report(f.connection, { ...f.report, observedAgeMs: 2000 });
    vi.advanceTimersByTime(BROWSER_PLAYBACK_FRESH_MS - 2000);
    expect(f.onChanged).toHaveBeenCalledTimes(2);
    expect(f.sources.read().sources).toEqual([]);
    expect(f.sources.report(f.connection, { ...f.report, sequence: 2 })).toMatchObject({ accepted: false, reason: "stale_source" });
  });
  it("cannot revive an old binding after disable, invalid reports or catalog replacement", () => {
    const f = fixture(); f.sources.report(f.connection, f.report);
    f.flags.enabled = false; f.sources.refresh(); f.flags.enabled = true;
    expect(f.sources.report(f.connection, { ...f.report, sequence: 2 })).toMatchObject({ accepted: false });
    const next = { ...f.report, attachmentId: randomUUID(), attachmentGeneration: 2 };
    f.sources.report(f.connection, next); f.sources.report(f.connection, { ...next, sequence: 2, accepted: true });
    expect(f.sources.report(f.connection, { ...next, sequence: 3 })).toMatchObject({ accepted: false });
    f.sources.report(f.connection, { ...next, attachmentId: randomUUID(), attachmentGeneration: 3 });
    f.catalogs.publish({ ...f.catalog, catalogGeneration: 2 }, f.provenance); f.sources.refresh();
    expect(f.sources.read().sources).toEqual([]);
  });
  it("keeps pause/seek/visibility facts without turning observations into acceptance or other actions", () => {
    const f = fixture(); f.sources.report(f.connection, f.report);
    f.sources.report(f.connection, { ...f.report, sequence: 2, sample: { ...f.report.sample, state: "seeking",
      positionSeconds: 190, visible: false, pictureInPicture: true } });
    expect(f.sources.read().sources[0]!.sample).toMatchObject({ state: "seeking", positionSeconds: 190, pictureInPicture: true });
    expect(f.sources.read().sources[0]).not.toHaveProperty("accepted");
    f.connections.remove(f.connection); expect(f.sources.read().sources).toEqual([]);
  });
  it("registers strict Node report/operator read methods and retains tombstones on invalid RPC params", async () => {
    const f = fixture(); const registry = createMethodRegistry(); registerBrowserPlaybackMethods(registry, f);
    const context = (connection = f.connection) => ({ connection, notify: vi.fn(), close: vi.fn(), onClose: vi.fn() });
    const dispatch = (method: string, params: unknown, connection = f.connection) => registry.dispatch(
      { jsonrpc: "2.0", id: "test", method, params }, context(connection));
    expect(await dispatch("browser.playback.ready", { schemaVersion: "taki.browser-playback.v1" }))
      .toMatchObject({ result: { enabled: true, hostId: f.identity.deviceId } });
    expect(await dispatch("browser.playback.report", f.report)).toMatchObject({ result: { accepted: true } });
    expect(await dispatch("browser.playback.read", {})).toHaveProperty("error");
    const operator = f.connections.create(); f.connections.authenticate(operator, { deviceId: randomUUID(), role: "operator", capabilities: [] });
    expect(await dispatch("browser.playback.read", {}, operator)).toMatchObject({ result: { enabled: true, sources: [expect.any(Object)] } });
    expect(await dispatch("browser.playback.report", { ...f.report, sequence: 2, token: "wrong" })).toHaveProperty("error");
    expect(await dispatch("browser.playback.report", { ...f.report, sequence: 3 })).toMatchObject({ result: { accepted: false, reason: "stale_source" } });
    expect(await dispatch("browser.playback.read", {}, f.connections.create())).toHaveProperty("error");
  });
});
