import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createExtensionTools } from "../extensions/extension-tools.ts";
import { stableSubjectId } from "../mcp/mcp-tool-identity.ts";
import { probeMediaAccess } from "./media-access-probe.ts";

function fixture() {
  const ownerHostId = randomUUID(); const serverId = "media-server";
  const result = { schema_version: "bilinote.media-access.v1", service_instance_id: randomUUID(),
    source: { platform: "bilibili", bvid: "BV1UEaq6qEZt", cid: "42265479965", page: 2,
      canonical_url: "https://www.bilibili.com/video/BV1UEaq6qEZt?p=2" }, title: "Exact second part", duration_seconds: null,
    access: { kind: "video_range", byte_length: 1024, checked_at: Date.now() } };
  const call = vi.fn(async (_input: unknown): Promise<unknown> => { void _input; return { structuredContent: result }; });
  const flags = { current: true };
  const registry = createExtensionRegistry({ runId: randomUUID(), primaryHostId: ownerHostId, hosts: [], candidates: [{
    identity: { kind: "mcp-tool", ownerHostId, subjectId: stableSubjectId(serverId, "bilinote_probe_media"),
      subjectRevision: "r1", connectionGeneration: 1, catalogGeneration: 1 },
    displayName: "bilinote_probe_media", summary: "Probe existing media access", callMode: "mcp-tool",
    isCurrent: () => flags.current, call,
  }] });
  return { ownerHostId, serverId, result, call, flags, context: { tools: createExtensionTools(registry) },
    videoUrl: result.source.canonical_url };
}

it("probes through the exact captured service and owner, retaining native part identity and unknown duration", async () => {
  const f = fixture();
  expect(await probeMediaAccess(f)).toEqual(f.result);
  expect(f.call).toHaveBeenCalledTimes(1);
  expect(f.call.mock.calls[0]?.[0]).toEqual({ video_url: f.videoUrl });
});

it("does not substitute another service or Host when the captured exact binding is absent", async () => {
  const f = fixture();
  await expect(probeMediaAccess({ ...f, serverId: "other-service" })).rejects.toThrow("MEDIA_ACCESS_UNAVAILABLE");
  await expect(probeMediaAccess({ ...f, ownerHostId: randomUUID() })).rejects.toThrow("MEDIA_ACCESS_UNAVAILABLE");
  expect(f.call).not.toHaveBeenCalled();
});

it("rejects source retirement and cancellation after native IO", async () => {
  const f = fixture(); const controller = new AbortController();
  f.call.mockImplementationOnce(async () => {
    controller.abort();
    return { structuredContent: f.result };
  });
  await expect(probeMediaAccess({ ...f, signal: controller.signal })).rejects.toThrow("MEDIA_ACCESS_UNAVAILABLE");
  f.flags.current = false;
  await expect(probeMediaAccess(f)).rejects.toThrow("MEDIA_ACCESS_UNAVAILABLE");
  expect(f.call).toHaveBeenCalledTimes(1);
});

it("does not accept metadata for a different requested part or fabricated zero-byte access", async () => {
  const f = fixture();
  await expect(probeMediaAccess({ ...f, videoUrl: "https://www.bilibili.com/video/BV1UEaq6qEZt?p=1" }))
    .rejects.toThrow("MEDIA_ACCESS_MISMATCH");
  f.result.access.byte_length = 0;
  await expect(probeMediaAccess(f)).rejects.toThrow();
});

it("propagates the native failure instead of reporting successful access", async () => {
  const f = fixture();
  f.call.mockResolvedValue({ isError: true, structuredContent: { ok: false, error: { code: "media_access_denied" } } });
  await expect(probeMediaAccess(f)).rejects.toThrow("media_access_denied");
});
