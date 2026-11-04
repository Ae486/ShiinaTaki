import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { BrowserPlaybackView, MediaAccessProbeResult } from "@taki/shared";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createViewingInvitationEvidence } from "./viewing-invitation-evidence.ts";
import { probeMediaAccess } from "./media-access-probe.ts";
import { withNativeToolImages } from "../agents/native-tool-images.ts";

vi.mock("./media-access-probe.ts", () => ({ probeMediaAccess: vi.fn() }));
const probe = vi.mocked(probeMediaAccess);
const id = "11111111-1111-4111-8111-111111111111";
const databases: ReturnType<typeof initiativeFixture>["db"][] = [];
afterEach(() => { vi.clearAllMocks(); for (const db of databases.splice(0)) db.close(); });

function fixture(options: { projected?: boolean } = {}) {
  const db = initiativeFixture(); databases.push(db.db);
  const source: BrowserPlaybackView = { sourceRef: id, hostId: id, connectionGeneration: 1, catalogGeneration: 1,
    attachmentId: id, attachmentGeneration: 1, sequence: 10,
    source: { tabId: 1, frameId: 0, documentId: id, playerId: id,
      media: { kind: "bilibili", bvid: "BV1BTP5euE75", cid: "28581954126", page: 1 } },
    sample: { state: "playing", positionSeconds: 70, durationSeconds: 400, playbackRate: 1, visible: true, pictureInPicture: false },
    receivedAt: new Date().toISOString(), freshUntil: new Date(Date.now() + 5000).toISOString() };
  const proof: MediaAccessProbeResult = { schema_version: "bilinote.media-access.v1", service_instance_id: id,
    source: { platform: "bilibili", bvid: source.source.media.bvid, cid: source.source.media.cid, page: 1,
      canonical_url: "https://www.bilibili.com/video/BV1BTP5euE75?p=1" },
    title: "Video", duration_seconds: 400, access: { kind: "video_range", byte_length: 1024, checked_at: Date.now() } };
  probe.mockResolvedValue(proof);
  let enabled = true; let current = true; let sensitive = false; let pixelsCurrent = true;
  const nativeRelease = vi.fn(); const returned: unknown[] = [];
  const identity = (name: string) => ({ extensionId: name, kind: "capability" as const, ownerHostId: id,
    subjectId: name, subjectRevision: "1", connectionGeneration: 1, catalogGeneration: 1 });
  const invoke = vi.fn(async ({ extensionId }: { extensionId: string }) => {
    const capture = { dataBase64: "AAAA", mediaType: "image/png" as const, width: 1, height: 1 };
    const output = { ok: true, owner: identity(extensionId), output: { ok: true,
      output: extensionId === "foreground-window"
        ? { available: true, processName: "msedge.exe", windowTitle: "Video", idleSeconds: 0 }
        : options.projected ? { width: 1, height: 1, mediaType: "image/png" } : capture } };
    if (options.projected && extensionId === "screenshot-ambient") withNativeToolImages(output, {
      images: [{ mediaType: capture.mediaType, dataBase64: capture.dataBase64 }], refs: [], context: "Native ambient capture",
      isCurrent: () => pixelsCurrent && current, release: nativeRelease,
    });
    returned.push(output); return output;
  });
  const discard = vi.fn();
  const prepare = createViewingInvitationEvidence({ ownerHostId: id, nativeTarget: () => ({ serverId: "native", isCurrent: () => current }),
    enabled: () => enabled, perception: { pause: { isPaused: () => false }, isSensitive: () => sensitive,
      evidence: { generation: () => 1, isCurrent: () => current } },
    store: { save: () => ({ name: "frame", bytes: 3 }), discard, sweepOlderThan: () => ({ removedCount: 0, freedBytes: 0 }) },
    dropRawAfterConsumption: true,
  });
  const input = { source, expiresAt: Date.now() + 120_000, isCurrent: () => current };
  const turn = { runId: id, attemptId: id, runContext: { tools: {
    extension_discover: tool({ inputSchema: z.object({ query: z.string() }), execute: ({ query }) => ({ runId: id,
      entries: [{ identity: identity(query), displayName: query, summary: "", callMode: "capability", available: true }], truncated: false }) }),
    extension_call: tool({ inputSchema: z.object({ extensionId: z.string() }), execute: invoke }),
  } } };
  return { prepare: () => prepare(input, turn), proof, invoke, discard, nativeRelease, returned,
    retirePixels: () => { pixelsCurrent = false; },
    disable: () => { enabled = false; }, retire: () => { current = false; }, sensitive: () => { sensitive = true; } };
}

describe("admitted viewing evidence", () => {
  it("requires native access plus screened real capture and returns scrubbed fenced evidence", async () => {
    const f = fixture(); const result = await f.prepare();
    expect(result?.title).toBe("Video");
    expect(result?.text).toContain("Native access");
    expect(result?.nativeImageContext?.images).toEqual([{ mediaType: "image/png", dataBase64: "AAAA" }]);
    expect(result?.text).not.toContain("alice@example.com");
    expect(result?.text.length).toBeLessThan(4000);
    expect(f.invoke.mock.calls.map(([value]) => value.extensionId)).toEqual(["foreground-window", "screenshot-ambient"]);
    expect(f.discard).not.toHaveBeenCalled(); result?.nativeImageContext?.release(); expect(f.discard).toHaveBeenCalledOnce();
  });
  it("reads native projected ambient evidence before schema parsing and releases it with the same-attempt frame", async () => {
    const f = fixture({ projected: true }); const result = await f.prepare();
    expect(JSON.stringify(f.returned)).not.toContain("AAAA");
    expect(result?.nativeImageContext.images).toEqual([{ mediaType: "image/png", dataBase64: "AAAA" }]);
    expect(f.invoke.mock.calls.map(([value]) => value.extensionId)).toEqual(["foreground-window", "screenshot-ambient"]);
    expect(f.nativeRelease).not.toHaveBeenCalled(); result?.nativeImageContext.release(); result?.nativeImageContext.release();
    expect(f.nativeRelease).toHaveBeenCalledOnce(); expect(f.discard).toHaveBeenCalledOnce();
  });
  it("retires projected native evidence before a later provider dispatch and discards the live retained frame", async () => {
    const f = fixture({ projected: true }); const result = await f.prepare(); f.retirePixels();
    expect(result?.nativeImageContext.isCurrent()).toBe(false); expect(result?.nativeImageContext.images).toEqual([]);
    expect(f.nativeRelease).toHaveBeenCalledOnce(); expect(f.discard).toHaveBeenCalledOnce();
  });
  it("releases a projected capture that is invalidated while the capability is settling", async () => {
    const f = fixture({ projected: true }); const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (input) => { const output = await original(input);
      if (input.extensionId === "screenshot-ambient") f.retire(); return output; });
    expect(await f.prepare()).toBeUndefined(); expect(f.nativeRelease).toHaveBeenCalledOnce(); expect(f.discard).not.toHaveBeenCalled();
  });

  it("performs no probe or capture while ambient consent is off", async () => {
    const f = fixture(); f.disable(); expect(await f.prepare()).toBeUndefined();
    expect(probe).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
  });
  it("does not capture or use a different native part", async () => {
    const f = fixture(); f.proof.source.cid = "123";
    expect(await f.prepare()).toBeUndefined(); expect(f.invoke).not.toHaveBeenCalled();
  });
  it("rejects sensitive foreground before capture", async () => {
    const f = fixture(); f.sensitive(); expect(await f.prepare()).toBeUndefined(); expect(f.invoke).toHaveBeenCalledOnce();
  });
  it("discards captured pixels when source authority retires before main dispatch", async () => {
    const f = fixture(); const result = await f.prepare(); f.retire();
    expect(result?.isCurrent()).toBe(false); expect(result?.nativeImageContext?.isCurrent()).toBe(false);
    expect(f.discard).toHaveBeenCalledOnce(); result?.nativeImageContext?.release(); expect(f.discard).toHaveBeenCalledOnce();
  });
  it("refuses a late capture callback before saving or returning native input", async () => {
    const f = fixture(); const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (input) => { const result = await original(input); if (input.extensionId === "screenshot-ambient") f.retire(); return result; });
    expect(await f.prepare()).toBeUndefined(); expect(f.discard).not.toHaveBeenCalled();
  });
});
