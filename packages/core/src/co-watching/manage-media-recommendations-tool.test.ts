import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { TimelineEntry } from "@taki/shared";
import { createChatAgent } from "../agents/chat-agent.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import type { MediaAnalysisRuntime } from "./media-analysis-runtime.ts";
import { createManageMediaRecommendationsTool, MEDIA_RECOMMENDATIONS_SKILL } from "./manage-media-recommendations-tool.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const userEntry: TimelineEntry = { id: randomUUID(), seq: 1, characterId: "taki", role: "user",
  content: "Pick a few recommendations for me", createdAt: new Date().toISOString() };
const connection = { state: { status: "authenticated" as const, deviceId: "operator", role: "operator" as const, capabilities: [] } };
const turn = { connection, runId: randomUUID(), attemptId: randomUUID() };
const options = { toolCallId: "selected-preparation", messages: [], context: undefined };
const prepareInput = { action: "prepare_recommendations", videoUrls: ["https://www.bilibili.com/video/BV1UEaq6qEZt?p=1"],
  lifetimeMinutes: null, batchId: null, jobRequestId: null };

function fixture() {
  const prepare = vi.fn<MediaAnalysisRuntime["prepare"]>(async () => ({ accepted: false, reason: "not_ready" }));
  const preparation = vi.fn<MediaAnalysisRuntime["preparation"]>(() => null);
  const cancelPreparation = vi.fn<MediaAnalysisRuntime["cancelPreparation"]>(() => ({ accepted: false, reason: "not_found" }));
  const runtime: MediaAnalysisRuntime = { prepare, preparation, cancelPreparation,
    analyze: async () => ({ accepted: false, reason: "not_ready" }), read: () => null,
    cancel: () => ({ accepted: false, reason: "not_found" }), context: () => "", released() {}, yieldToPrimary() {}, async close() {} };
  const tools = createManageMediaRecommendationsTool({ runtime, userEntry, characterId: "taki", turn });
  return { runtime, tools, prepare, preparation, cancelPreparation };
}

it("uses only the real primary entry and current Run/Attempt source without inventing a user message", async () => {
  const f = fixture();
  expect(await f.tools.manage_media_recommendations!.execute!(prepareInput, options)).toEqual({ ok: false, reason: "not_ready" });
  expect(f.prepare).toHaveBeenCalledWith({ characterId: "taki", requestId: userEntry.id,
    videoUrls: prepareInput.videoUrls, lifetimeMinutes: 120 },
  { runId: turn.runId, attemptId: turn.attemptId, userTimelineSeq: userEntry.seq, userTimelineId: userEntry.id,
    interactive: { connection, signal: undefined } });
  for (const candidate of [undefined, { ...turn, turnKind: "non-primary" as const }, { ...turn, connection: undefined }]) {
    expect(createManageMediaRecommendationsTool({ runtime: f.runtime, userEntry, characterId: "taki", turn: candidate })).toEqual({});
  }
  expect(createManageMediaRecommendationsTool({ runtime: f.runtime, userEntry: { ...userEntry, role: "assistant" }, characterId: "taki", turn })).toEqual({});
});

it("scopes status/cancel to returned batch and item identities and refuses mixed selection fields", async () => {
  const f = fixture(); const execute = f.tools.manage_media_recommendations!.execute!;
  const batchId = randomUUID(); const jobRequestId = randomUUID();
  expect(await execute({ action: "preparation_status", videoUrls: null, lifetimeMinutes: null, batchId, jobRequestId: null }, options))
    .toEqual({ ok: true, status: "preparation_status", batch: null });
  expect(f.preparation).toHaveBeenCalledWith("taki", batchId);
  await execute({ action: "preparation_cancel", videoUrls: null, lifetimeMinutes: null, batchId, jobRequestId }, options);
  expect(f.cancelPreparation).toHaveBeenCalledWith("taki", { batchId, jobRequestId });
  for (const request of [{ ...prepareInput, batchId }, { ...prepareInput, action: "preparation_cancel", videoUrls: null },
    { ...prepareInput, action: "preparation_status" }]) {
    expect(await execute(request, options)).toEqual({ ok: false, reason: "invalid_request" });
  }
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.cancelPreparation).toHaveBeenCalledTimes(1);
});

it("reveals the actual recommendation control only after its captured Skill loads on a previous model step", async () => {
  const f = fixture(); const base = createCompanionFixture(); fixtures.push(base);
  const model = scriptedModel([
    { kind: "tool", toolCallId: "load", toolName: "load_skill", input: { name: MEDIA_RECOMMENDATIONS_SKILL } },
    { kind: "tool", toolCallId: "prepare", toolName: "manage_media_recommendations", input: prepareInput },
    { kind: "text", deltas: ["Preparation request checked"] },
  ]);
  const loaded = { ok: true, content: "Prepare only selected recommendations", contentRevision: "r1", files: [] };
  const entries: TimelineEntry[] = [];
  const agent = createChatAgent({ model, store: base.conversation, memory: base.memory,
    extraTools: { load_skill: tool({ inputSchema: z.object({ name: z.string() }), execute: () => loaded }) },
    skillTools: (input) => {
      if (!input.userEntry) return [];
      entries.push(input.userEntry);
      return [{ skillName: MEDIA_RECOMMENDATIONS_SKILL,
        tools: createManageMediaRecommendationsTool({ ...input, userEntry: input.userEntry, runtime: f.runtime }) }];
    },
  });
  for await (const _delta of agent.stream({ characterId: "taki", message: "Prepare these selected videos" }, { ...turn,
    runContext: { toolDisclosure: { deferredToolNames: [], describedTools: {},
      skills: { [MEDIA_RECOMMENDATIONS_SKILL]: { extensionId: "ext:recommendations", contentRevision: "r1" } } },
    tools: { extension_call: tool({ inputSchema: z.object({ extensionId: z.string(), input: z.unknown() }),
      execute: () => ({ ok: true, owner: { extensionId: "ext:recommendations" }, output: loaded }) }) } },
  })) { void _delta; }
  expect(model.doStreamCalls[0]?.tools?.map((entry) => entry.name)).not.toContain("manage_media_recommendations");
  expect(model.doStreamCalls[1]?.tools?.map((entry) => entry.name)).toContain("manage_media_recommendations");
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(entries[0]?.role).toBe("user");
  expect(f.prepare.mock.calls[0]?.[0].requestId).toBe(entries[0]?.id);
});
