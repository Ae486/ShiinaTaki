import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tool } from "ai";
import { z } from "zod";
import { ContextRequestMeasuredPayloadSchema, RequestCompositionSchema, type EffectLifecycle, type RunEvent } from "@taki/shared";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { captureCanonicalMemoryAssembly } from "../memory/canonical-memory-assembly.ts";
import { createChatAgent } from "./chat-agent.ts";
import { createConversationStore } from "./conversation-store.ts";
import { attributedRenderer, contextText, joinContextText, retainContentOrigin } from "./context-attribution.ts";
import { estimateTokens } from "../memory/token-estimator.ts";
import { createEffectLifecycleService, type EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createPrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import { createRequestAttributionRepo } from "../db/request-attribution-repo.ts";
import type { Database } from "../db/sqlite.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
type Request = { model: string; tools?: { function: { name: string } }[]; messages: unknown[] };

function seedRun(db: Database) {
  const at = "2026-11-02T08:00:00.000Z";
  db.prepare(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES ('snapshot','run','harness.v1','{}',:digest,:at,:at)`).run({ digest: "a".repeat(64), at });
  db.prepare(`INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
    delivery_class,state,snapshot_id,active_attempt_id,queued_at,created_at,updated_at)
    VALUES ('run','taki','request','request','h','primary','{}','class_a','running','snapshot','attempt',:at,:at,:at)`).run({ at });
  db.exec(`INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,provider,model_id,snapshot_id)
    VALUES ('attempt','run',1,'effect_running','attribution-fixture.chat','main','snapshot')`);
}

async function run(measured: boolean, options: { persist?: boolean; responseModelId?: string } = {}) {
  const fixture = createCompanionFixture(); fixtures.push(fixture);
  fixture.conversation.appendUser("taki", "Prior private conversation");
  if (options.persist) seedRun(fixture.db);
  const timeline = createTimelineRepo(fixture.db);
  const store = createConversationStore({ repo: timeline,
    ...(options.persist ? { primarySources: { repo: createPrimaryConversationSourceRepo({ db: fixture.db, timeline }),
      afterCommit: fixture.db.afterCommit } } : {}),
    summaries: { get: () => ({ throughSeq: 1, text: "Selected relationship summary" }) } });
  const requests: Request[] = [];
  const records: Omit<RunEvent, "eventId" | "seq">[] = [];
  const provider = createOpenAICompatible({ name: "attribution-fixture", baseURL: "https://attribution.invalid/v1", fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Request);
    const call = requests.length - 1;
    const delta = call < 2 ? { tool_calls: [{ index: 0, id: call ? "query" : "load", type: "function",
      function: { name: call ? "alpha_query" : "load_skill", arguments: call ? "{}" : '{"name":"alpha"}' } }] } : { content: "Completed" };
    const chunk = { id: "same-sdk-generation", object: "chat.completion.chunk", created: 0, model: options.responseModelId ?? "main",
      choices: [{ index: 0, delta, finish_reason: call < 2 ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 5000 + call, completion_tokens: 2, total_tokens: 5002 + call } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  let ordinal = 0;
  const eventRepo = createRunEventRepo(fixture.db);
  const lifecycle: EffectLifecycleService = options.persist
    ? createEffectLifecycleService(createEffectRepo(fixture.db, eventRepo), undefined, { eventRepo }) : {
    prepare(input) { const effect = { ...input, effectId: `effect-${++ordinal}`, schemaVersion: "effect.v1", state: "intent_committed", version: 0 } as unknown as EffectLifecycle;
      input.onCommitIntent?.(effect); return effect; },
    settle: () => ({ duplicate: false, stale: false }), get: () => undefined, unfinished: () => [], record: (event) => { records.push(event); },
  };
  const loaded = retainContentOrigin({ ok: true, content: "Skill-supplied guide", contentRevision: "alpha-v1", files: [] }, "skill");
  const extensionCall = retainContentOrigin(tool({ inputSchema: z.object({ extensionId: z.string(), input: z.unknown() }),
    execute: () => retainContentOrigin({ ok: true, owner: { extensionId: "ext:alpha" }, output: loaded }, "skill") }), "builtin");
  const assembly = captureCanonicalMemoryAssembly({ characterId: "taki", rows: [], blocks: "A verified persistent Memory Block",
    persona: { assistantLayer: () => "Global companion persona", persona: () => "Selected Character persona" } });
  const agent = createChatAgent({ model: provider("main"), store, memory: fixture.memory,
    ...(measured ? { effectLifecycle: lifecycle } : {}), requestWindowSnapshot: () => ({ declaredRealTokens: 128000,
      effectiveRealTokens: 120000, estimatorWindowUnits: 60000, factor: 2 }),
    volatileContext: () => "Accepted runtime environment", runContext: () => ({ tools: { extension_call: extensionCall }, assembleMemory: assembly,
      automaticMemoryRecall: async () => "Automatic recalled Memory", toolDisclosure: { deferredToolNames: [], describedTools: {},
        skills: { alpha: { extensionId: "ext:alpha", contentRevision: "alpha-v1" } } } }),
    extraTools: { load_skill: retainContentOrigin(tool({ inputSchema: z.object({ name: z.string() }), execute: () => loaded }), "builtin") },
    skillTools: () => [{ skillName: "alpha", tools: { alpha_query: tool({ description: "A deliberately large active schema description".repeat(50),
      inputSchema: z.object({}), execute: () => ({ ok: true, source: "Core registered query" }) }) } }],
    instructionsExtra: attributedRenderer(() => joinContextText([contextText("Core avatar guidance", "instructions"), contextText("alpha Skill description", "instructions", "skill")])),
  });
  let text = "";
  for await (const delta of agent.stream({ characterId: "taki", message: "Load the Skill and inspect" }, { runId: "run", attemptId: "attempt" })) text += delta;
  const payloads = options.persist
    ? fixture.db.prepare("SELECT payload_json FROM run_events WHERE kind='context.request.measured' ORDER BY seq")
      .all().map((row) => JSON.parse(String(row.payload_json)) as unknown)
    : records.filter((event) => event.schemaVersion === "context-request.v1").map((event) => event.payload);
  return { db: fixture.db, requests, measurements: payloads
    .map((payload) => ({ payload: ContextRequestMeasuredPayloadSchema.parse(payload) })), text,
    timeline: createTimelineRepo(fixture.db).latestAscending("taki", 20) };
}

describe("actual SDK dispatch attribution", () => {
  it("projects the latest persisted SDK request when the compatible provider reports a different response model", async () => {
    const result = await run(true, { persist: true, responseModelId: "served-main" });
    expect(result.text).toBe("Completed");
    expect(result.requests).toHaveLength(3);
    expect(result.requests.every((request) => request.model === "main")).toBe(true);
    expect(result.measurements.map(({ payload }) => payload.modelId)).toEqual(["main", "main", "main"]);
    const rows = result.db.prepare(`SELECT e.effect_id,e.source_ref_json,u.model_id,u.input_tokens FROM run_effects e
      JOIN run_usage u ON u.effect_id=e.effect_id WHERE e.kind='model' ORDER BY e.rowid`).all();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.model_id)).toEqual(["served-main", "served-main", "served-main"]);
    expect(rows.every((row) => JSON.parse(String(row.source_ref_json)).modelId === "main")).toBe(true);
    const final = result.measurements[2]!.payload;
    expect(createRequestAttributionRepo(result.db).read("taki")).toMatchObject({ status: "ready", reason: null, request: {
      effectId: final.effectId, primaryInputSeq: 2, stepNumber: 2, modelId: "main", responseModelId: "served-main",
      inputTokens: 5002, window: final.window, composition: final.composition,
    } });
    expect(final.composition.categories.tool_interactions).toBeGreaterThan(0);
  });
  it("samples every active-schema continuation, preserves Skill supplier without reclassifying enabled Core tools, and leaves provider bytes unchanged", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T08:00:00.000Z"));
    const measured = await run(true);
    const baseline = await run(false);
    expect(measured.text).toBe("Completed");
    expect(measured.requests).toEqual(baseline.requests);
    expect(measured.measurements).toHaveLength(3);
    const first = measured.measurements[0]!.payload;
    const continuation = measured.measurements[1]!.payload;
    const final = measured.measurements[2]!.payload;
    expect(measured.measurements.map((event) => event.payload.stepNumber)).toEqual([0, 1, 2]);
    expect(new Set(measured.measurements.map((event) => event.payload.effectId)).size).toBe(3);
    expect(measured.measurements.every((event) => event.payload.primaryInputSeq === 2)).toBe(true);
    expect(measured.requests[0]?.tools?.some((entry) => entry.function.name === "alpha_query")).toBe(false);
    expect(measured.requests[1]?.tools?.some((entry) => entry.function.name === "alpha_query")).toBe(true);
    expect(continuation.composition.categories.tool_definitions).toBeGreaterThan(first.composition.categories.tool_definitions + 300);
    for (const category of ["instructions", "persona", "injected_memory", "runtime_context", "summary", "conversation", "tool_definitions", "other"] as const) {
      expect(first.composition.categories[category]).toBeGreaterThan(0);
    }
    expect(first.composition.categories.tool_interactions).toBe(0);
    expect(continuation.composition.origins.tool_interactions.skill).toBeGreaterThan(0);
    expect(final.composition.origins.tool_interactions.builtin).toBeGreaterThan(0);
    expect(continuation.composition.origins.tool_definitions.skill).toBe(0);
    expect(first.composition.origins.instructions.skill).toBe(estimateTokens("alpha Skill description"));
    expect(final.window).toEqual({ declaredRealTokens: 128000, effectiveRealTokens: 120000, estimatorWindowUnits: 60000, factor: 2 });
    for (const event of measured.measurements) expect(RequestCompositionSchema.safeParse(event.payload.composition).success).toBe(true);
    const toolParts = measured.timeline.flatMap((entry) => entry.parts ?? []).filter((part) => part.type === "tool-result");
    expect(toolParts.find((part) => part.toolCallId === "load")?.contextOrigin).toBe("skill");
    expect(toolParts.find((part) => part.toolCallId === "query")?.contextOrigin).toBe("builtin");
    expect(JSON.stringify(measured.measurements)).not.toContain("Skill-supplied guide");
  });
});
