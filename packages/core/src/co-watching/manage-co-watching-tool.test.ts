import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import type { ToolExecutionOptions } from "ai";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { createManageCoWatchingTool } from "./manage-co-watching-tool.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createCoWatchingAnalysisReader } from "./read-analysis.ts";
import { stableSubjectId } from "../mcp/mcp-tool-identity.ts";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createExtensionTools } from "../extensions/extension-tools.ts";
import type { MediaAnalysisJob } from "@taki/shared";
import type { MediaAnalysisRuntime } from "./media-analysis-runtime.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
async function fixture() { const f = await coWatchingFixture(); fixtures.push(f); return f; }
const userEntry: TimelineEntry = { id: randomUUID(), seq: 1, characterId: "taki", role: "user", content: "Revise future reactions", createdAt: new Date().toISOString() };
const options: ToolExecutionOptions<unknown> = { toolCallId: "control-test", messages: [], context: undefined };

function analysisRuntimeStub() {
  const job: MediaAnalysisJob = { requestId: userEntry.id, characterId: "taki", status: "accepted", reason: null,
    videoUrl: "https://www.bilibili.com/video/BV1UEaq6qEZt?p=1", runId: randomUUID(), analysisId: null, title: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const analyze = vi.fn<MediaAnalysisRuntime["analyze"]>(async () => ({ accepted: true as const, job }));
  const cancel = vi.fn<MediaAnalysisRuntime["cancel"]>(() => ({ accepted: true as const, job: { ...job, status: "cancelled" as const, reason: "cancelled" as const } }));
  const runtime: MediaAnalysisRuntime = { analyze, read: () => job, cancel, released() {}, context: () => "",
    prepare: async () => ({ accepted: false, reason: "not_ready" }), preparation: () => null,
    cancelPreparation: () => ({ accepted: false, reason: "not_found" }),
    yieldToPrimary() {}, close: async () => undefined };
  return { runtime, analyze, cancel, job };
}

describe("governed primary Co-Watching control surface", () => {
  it("accepts an explicit URL without playback using the committed user identity and leaves Co-Watching untouched", async () => {
    const f = await fixture(); f.flags.source = false;
    const analysis = analysisRuntimeStub();
    const invite = vi.spyOn(f.runtime, "invite");
    const tools = createManageCoWatchingTool({ runtime: f.runtime, analysisRuntime: analysis.runtime,
      characterId: "taki", userEntry, turn: { connection: f.interactive.connection, runId: "foreground", attemptId: "attempt" } });
    expect(await tools.manage_co_watching!.execute!({ action: "analyze_url", instruction: null,
      videoUrl: analysis.job.videoUrl, lifetimeMinutes: 25 }, options)).toMatchObject({ ok: true, status: "analysis_accepted" });
    expect(analysis.analyze.mock.calls[0]?.[0]).toEqual({ characterId: "taki", requestId: userEntry.id,
      videoUrl: analysis.job.videoUrl, instruction: userEntry.content, lifetimeMinutes: 25 });
    expect(invite).not.toHaveBeenCalled(); expect(f.submitNative).not.toHaveBeenCalled();
  });

  it("reads and cancels the independent accepted analysis without stopping a Co-Watching session", async () => {
    const f = await fixture(); const analysis = analysisRuntimeStub();
    const stop = vi.spyOn(f.runtime, "stop");
    const tools = createManageCoWatchingTool({ runtime: f.runtime, analysisRuntime: analysis.runtime,
      characterId: "taki", userEntry, turn: { connection: f.interactive.connection, runId: "foreground", attemptId: "attempt" } });
    expect(await tools.manage_co_watching!.execute!({ action: "analysis_status", instruction: null }, options))
      .toMatchObject({ ok: true, status: "analysis_status", job: analysis.job });
    expect(await tools.manage_co_watching!.execute!({ action: "analysis_cancel", instruction: null }, options))
      .toMatchObject({ ok: true, status: "analysis_cancelled", job: { status: "cancelled" } });
    expect(analysis.cancel).toHaveBeenCalledWith("taki", userEntry.id); expect(stop).not.toHaveBeenCalled();
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it("reads existing analysis through the ordinary primary tool without creating accepted work", async () => {
    const f = await fixture(); f.flags.source = false;
    const ownerHostId = randomUUID();
    const registry = createExtensionRegistry({ runId: randomUUID(), primaryHostId: ownerHostId, hosts: [], candidates: [{
      identity: { kind: "mcp-tool", ownerHostId, subjectId: stableSubjectId(f.analysis.serverId, "bilinote_read_result"),
        subjectRevision: "r1", connectionGeneration: 1, catalogGeneration: 1 },
      displayName: "bilinote_read_result", summary: "Read existing result", callMode: "mcp-tool",
      isCurrent: () => true, call: f.readNative,
    }] });
    const model = scriptedModel([{ kind: "tool", toolCallId: "read", toolName: "manage_co_watching",
      input: { action: "read_analysis", instruction: null, analysisId: f.analysis.analysisId, view: "analysis", offset: 0 } },
      { kind: "text", deltas: ["Read the original analysis"] }]);
    const readAnalysis = createCoWatchingAnalysisReader({ catalog: f.catalog, ownerHostId });
    const agent = createChatAgent({ model, store: f.store, memory: f.memory,
      primaryTools: (input) => createManageCoWatchingTool({ ...input, runtime: f.runtime, readAnalysis }) });
    for await (const text of agent.stream({ characterId: "taki", message: "Read a previous video's analysis" }, {
      connection: f.interactive.connection, runId: randomUUID(), attemptId: randomUUID(),
      runContext: { tools: createExtensionTools(registry) },
    })) { expect(typeof text).toBe("string"); }
    expect(f.readNative).toHaveBeenCalledOnce();
    expect(f.runtime.read("taki").session).toBeNull();
    expect(f.submitNative).not.toHaveBeenCalled(); expect(f.lookupNative).not.toHaveBeenCalled();
    expect(f.statusNative).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    const nextRequest = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(nextRequest).toContain("Grounded test analysis");
    expect(nextRequest).toContain(f.analysis.analysisId);
    expect(nextRequest).toContain(f.analysis.media.cid);
    expect(nextRequest).not.toContain(f.analysis.native.sha256);
    expect(nextRequest).not.toContain(f.analysis.native.serviceInstanceId);
    expect(JSON.stringify(f.store.history("taki"))).toContain("analysis_read");
  });
  it.each([false, true])("lists registered references with no source or native availability, without accepting or submitting work (empty=%s)", async (empty) => {
    const f = await fixture(); f.flags.source = false; f.flags.native = false;
    if (empty) f.catalog.remove(f.analysis.analysisId, f.analysis.revision);
    const tools = createManageCoWatchingTool({ runtime: f.runtime, characterId: "taki", userEntry,
      turn: { connection: f.interactive.connection, runId: "foreground", attemptId: "attempt" } });
    const result = await tools.manage_co_watching!.execute!({ action: "list_analyses", instruction: null }, options);
    expect(result).toMatchObject({ ok: true, scope: "core_registered_analyses",
      analyses: empty ? [] : [{ analysisId: f.analysis.analysisId }] });
    expect(f.runtime.read("taki").session).toBeNull();
    expect(f.generate).not.toHaveBeenCalled(); expect(f.submitNative).not.toHaveBeenCalled(); expect(f.readNative).not.toHaveBeenCalled();
    expect(f.lookupNative).not.toHaveBeenCalled(); expect(f.statusNative).not.toHaveBeenCalled();
  });
  it("reports a catalog read failure instead of claiming an empty inventory", async () => {
    const f = await fixture();
    const tools = createManageCoWatchingTool({ runtime: f.runtime, characterId: "taki", userEntry,
      turn: { connection: f.interactive.connection, runId: "foreground", attemptId: "attempt" } });
    const read = vi.spyOn(f.runtime, "read").mockImplementationOnce(() => { throw new Error("catalog unavailable"); });
    expect(await tools.manage_co_watching!.execute!({ action: "list_analyses", instruction: null }, options))
      .toEqual({ ok: false, reason: "control_failed" });
    read.mockRestore();
    expect(f.runtime.read("taki").session).toBeNull();
    expect(f.submitNative).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  it("starts through ordinary ChatAgent when playback becomes available after tool assembly", async () => {
    const f = await fixture();
    const primary = await f.runs.admit({ triggerRequestId: "start-chat", idempotencyKey: "start-chat",
      characterId: "taki", initiator: "primary", deliveryClass: "class_a", contextMode: "primary", provenance: { provider: "chat" } });
    const reservation = f.queue.reservePrimary("taki"); const release = await reservation.acquire();
    f.runs.start(primary.run.runId, primary.attempt.attemptId);
    const model = scriptedModel([{ kind: "tool", toolCallId: "start", toolName: "manage_co_watching",
      input: { action: "start", instruction: null, sourceRef: null, lifetimeMinutes: 30 } }, { kind: "text", deltas: ["Queued"] }]);
    const agent = createChatAgent({ model, store: f.store, memory: f.memory,
      primaryTools: (input) => {
        f.flags.source = false;
        const tools = createManageCoWatchingTool({ ...input, runtime: f.runtime });
        f.flags.source = true;
        return tools;
      } });
    for await (const chunk of agent.stream({ characterId: "taki", message: "Watch this video with me" }, {
      connection: f.interactive.connection, runId: primary.run.runId, attemptId: primary.attempt.attemptId,
      turnKind: "primary", runContext: f.runs.context(primary.run.runId),
    })) { expect(typeof chunk).toBe("string"); }
    expect(f.session().status).toBe("starting"); expect(f.generate).not.toHaveBeenCalled();
    f.runs.settle(primary.run.runId, primary.attempt.attemptId, "completed"); release(); f.runtime.released();
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  });
  it("starts the sole selected source from an ordinary chat even while the video is hidden behind chat", async () => {
    const f = await fixture(); f.playback.sample.visible = false;
    const reservation = f.queue.reservePrimary("taki"); const release = await reservation.acquire();
    const tools = createManageCoWatchingTool({ runtime: f.runtime, characterId: "taki", userEntry,
      turn: { connection: f.interactive.connection, runId: "foreground", attemptId: "attempt" } });
    const first = await tools.manage_co_watching!.execute!({ action: "start", instruction: null }, options);
    const duplicate = await tools.manage_co_watching!.execute!({ action: "start", instruction: null }, options);
    expect(first).toMatchObject({ ok: true, status: "watching_queued" });
    expect(duplicate).toEqual(first); expect(f.generate).not.toHaveBeenCalled();
    release(); f.runtime.released();
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    expect(f.submitNative).not.toHaveBeenCalled();
  });
  it("advertises and executes semantic revision through the ordinary ChatAgent primary tool seam", async () => {
    const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    const primary = await f.runs.admit({ triggerRequestId: "revision-chat", idempotencyKey: "revision-chat",
      characterId: "taki", initiator: "primary", deliveryClass: "class_a", contextMode: "primary", provenance: { provider: "chat" } });
    const reservation = f.queue.reservePrimary("taki"); const release = await reservation.acquire();
    f.runs.start(primary.run.runId, primary.attempt.attemptId);
    const model = scriptedModel([{ kind: "tool", toolCallId: "revise", toolName: "manage_co_watching",
      input: { action: "revise", instruction: "One concise sentence, no questions" } }, { kind: "text", deltas: ["Revision queued"] }]);
    const agent = createChatAgent({ model, store: f.store, memory: f.memory,
      primaryTools: (input) => createManageCoWatchingTool({ ...input, runtime: f.runtime }) });
    for await (const chunk of agent.stream({ characterId: "taki", message: "Make future reactions shorter" }, {
      connection: f.interactive.connection, runId: primary.run.runId, attemptId: primary.attempt.attemptId,
      turnKind: "primary", runContext: f.runs.context(primary.run.runId),
    })) { expect(typeof chunk).toBe("string"); }
    expect(model.doStreamCalls[0]?.tools?.some((entry) => entry.name === "manage_co_watching")).toBe(true);
    expect(f.session()).toMatchObject({ status: "revising", pendingRevision: true });
    expect(f.generate).toHaveBeenCalledTimes(1);
    f.runs.settle(primary.run.runId, primary.attempt.attemptId, "completed"); release(); f.runtime.released();
    await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
    expect(f.generate.mock.calls[1]?.[0]).toContain("One concise sentence, no questions");
  });
  it("is absent without an accepted session, primary user entry and physical operator turn", async () => {
    const f = await fixture();
    const input = { runtime: f.runtime, characterId: "taki", userEntry };
    expect(createManageCoWatchingTool(input)).toEqual({});
    f.start();
    expect(createManageCoWatchingTool(input)).toEqual({});
    expect(createManageCoWatchingTool({ ...input, userEntry: { ...userEntry, role: "assistant" }, turn: {
      connection: f.interactive.connection, runId: "foreground", attemptId: "attempt" } })).toEqual({});
  });
  it("checks semantic inputs, contains runtime failures and returns a bounded stop outcome", async () => {
    const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    const controller = new AbortController();
    const tools = createManageCoWatchingTool({ runtime: f.runtime, characterId: "taki", userEntry,
      turn: { connection: f.interactive.connection, runId: "foreground", attemptId: "attempt", signal: controller.signal } });
    const execute = tools.manage_co_watching!.execute!;
    expect(await execute({ action: "stop", instruction: "unexpected" }, options)).toEqual({ ok: false, reason: "unexpected_instruction" });
    expect(await execute({ action: "revise", instruction: null }, options)).toEqual({ ok: false, reason: "instruction_required" });
    const revise = vi.spyOn(f.runtime, "revise").mockImplementationOnce(() => { throw new Error("internal implementation detail"); });
    expect(await execute({ action: "revise", instruction: "Be concise" }, options)).toEqual({ ok: false, reason: "control_failed" });
    revise.mockRestore();
    expect(await execute({ action: "stop", instruction: null }, options)).toMatchObject({ ok: true, status: "stopped" });
    controller.abort();
    expect(await execute({ action: "stop", instruction: null }, options)).toEqual({ ok: false, reason: "turn_cancelled" });
  });
});
