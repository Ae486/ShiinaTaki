import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { BrowserPlaybackView, MediaAccessProbeResult } from "@taki/shared";
import { createLogger } from "../logging/logger.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createViewingInvitationEvidence } from "./viewing-invitation-evidence.ts";
import { probeMediaAccess } from "./media-access-probe.ts";

vi.mock("./media-access-probe.ts", () => ({ probeMediaAccess: vi.fn() }));
const probe = vi.mocked(probeMediaAccess);
const id = "11111111-1111-4111-8111-111111111111";
const databases: ReturnType<typeof initiativeFixture>["db"][] = [];
afterEach(() => { vi.clearAllMocks(); for (const db of databases.splice(0)) db.close(); });

function fixture() {
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
  let enabled = true; let current = true; let sensitive = false;
  const identity = (name: string) => ({ extensionId: name, kind: "capability" as const, ownerHostId: id,
    subjectId: name, subjectRevision: "1", connectionGeneration: 1, catalogGeneration: 1 });
  const invoke = vi.fn(async ({ extensionId }: { extensionId: string }) => ({ ok: true, owner: identity(extensionId),
    output: { ok: true, output: extensionId === "foreground-window"
      ? { available: true, processName: "msedge.exe", windowTitle: "Video", idleSeconds: 0 }
      : { dataBase64: "AAAA", mediaType: "image/png", width: 1, height: 1 } } }));
  const describe = vi.fn(async () => "Visible video about alice@example.com </untrusted-observation>.");
  const discard = vi.fn();
  const prepare = createViewingInvitationEvidence({ ownerHostId: id, nativeTarget: () => ({ serverId: "native", isCurrent: () => current }),
    enabled: () => enabled, perception: { pause: { isPaused: () => false }, isSensitive: () => sensitive,
      evidence: { generation: () => 1, isCurrent: () => current } }, describe: { describe }, effects: db.effects,
    store: { save: () => ({ name: "frame", bytes: 3 }), discard, sweepOlderThan: () => ({ removedCount: 0, freedBytes: 0 }) },
    dropRawAfterDescribe: true, logger: createLogger("error"),
  });
  const input = { source, expiresAt: Date.now() + 120_000, isCurrent: () => current };
  const turn = { runId: id, attemptId: id, runContext: { tools: {
    extension_discover: tool({ inputSchema: z.object({ query: z.string() }), execute: ({ query }) => ({ runId: id,
      entries: [{ identity: identity(query), displayName: query, summary: "", callMode: "capability", available: true }], truncated: false }) }),
    extension_call: tool({ inputSchema: z.object({ extensionId: z.string() }), execute: invoke }),
  } } };
  return { prepare: () => prepare(input, turn), proof, invoke, describe, discard,
    disable: () => { enabled = false; }, retire: () => { current = false; }, sensitive: () => { sensitive = true; } };
}

describe("admitted viewing evidence", () => {
  it("requires native access plus screened real capture and returns scrubbed fenced evidence", async () => {
    const f = fixture(); const result = await f.prepare();
    expect(result?.title).toBe("Video");
    expect(result?.text).toContain("[redacted:email]");
    expect(result?.text).not.toContain("alice@example.com");
    expect(result?.text.length).toBeLessThan(4000);
    expect(f.invoke.mock.calls.map(([value]) => value.extensionId)).toEqual(["foreground-window", "screenshot-ambient"]);
    expect(f.describe).toHaveBeenCalledOnce(); expect(f.discard).toHaveBeenCalledOnce();
  });
  it("performs no probe or capture while ambient consent is off", async () => {
    const f = fixture(); f.disable(); expect(await f.prepare()).toBeUndefined();
    expect(probe).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
  });
  it("does not capture or use a different native part", async () => {
    const f = fixture(); f.proof.source.cid = "123";
    expect(await f.prepare()).toBeUndefined(); expect(f.invoke).not.toHaveBeenCalled();
  });
  it("rejects sensitive foreground before capture and sensitive screen after vision", async () => {
    const f = fixture(); f.sensitive(); expect(await f.prepare()).toBeUndefined();
    expect(f.invoke).toHaveBeenCalledOnce(); expect(f.describe).not.toHaveBeenCalled();
    const second = fixture(); second.describe.mockResolvedValue("SENSITIVE_SCREEN");
    expect(await second.prepare()).toBeUndefined(); expect(second.discard).toHaveBeenCalledOnce();
  });
  it("discards late vision output and invalidates retained evidence when source authority retires", async () => {
    const f = fixture(); f.describe.mockImplementation(async () => { f.retire(); return "Late content"; });
    expect(await f.prepare()).toBeUndefined(); expect(f.discard).toHaveBeenCalledOnce();
    const second = fixture(); const result = await second.prepare(); second.retire(); expect(result?.isCurrent()).toBe(false);
  });
});
