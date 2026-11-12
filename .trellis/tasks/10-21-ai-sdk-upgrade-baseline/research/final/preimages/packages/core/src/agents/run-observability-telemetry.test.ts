import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { EffectLifecycle } from "@taki/shared";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createEffectLifecycleService, type EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { abortRejectingModel, failingMockModel, midStreamErrorModel, scriptedModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
const at = "2026-08-28T00:00:00.000Z";

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function fixture() {
  const companion = createCompanionFixture(); fixtures.push(companion); seedRun(companion);
  const events = createRunEventRepo(companion.db);
  const lifecycle = createEffectLifecycleService(
    createEffectRepo(companion.db, events), undefined, { eventRepo: events },
  );
  return { companion, events, lifecycle };
}

function seedRun(fixture: CompanionFixture): void {
  fixture.db.exec(`
    INSERT INTO run_snapshots
      (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES ('snapshot','run','harness.v1','{}','${"a".repeat(64)}','${at}','${at}');
    INSERT INTO runs
      (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
       delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at)
    VALUES ('run','taki','trigger','idem','hash','primary','{}','class_a','running',0,'snapshot','attempt',
            '${at}','executing','${at}','${at}');
    INSERT INTO run_attempts
      (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id)
    VALUES ('attempt','run',1,'effect_running',0,'mock-provider','mock-model','snapshot');
  `);
}

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let output = "";
  for await (const chunk of stream) output += chunk;
  return output;
}

describe("Run observability telemetry", () => {
  it.each([false, true])("settles one unknown model Effect without replay after partial cancel, rejecting=%s", async rejecting => {
    const { companion, events, lifecycle } = fixture();
    const controller = new AbortController();
    const model = rejecting ? abortRejectingModel(["partial", "never"], 20) : slowStreamingModel(["partial", "never"], 20);
    const agent = createChatAgent({ model, store: companion.conversation, memory: companion.memory, effectLifecycle: lifecycle });
    let failure: unknown;
    try {
      for await (const delta of agent.stream({ characterId: "taki", message: "Fixture" }, {
        runId: "run", attemptId: "attempt", signal: controller.signal,
      })) { expect(delta).toBe("partial"); controller.abort("fixture cancel"); }
    } catch (error) { failure = error; }
    if (rejecting) expect(failure).toBe("fixture cancel");
    else expect(failure).toBeUndefined();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(companion.db.prepare("SELECT state,outcome FROM run_effects WHERE kind='model'").all())
      .toEqual([{ state: "terminal", outcome: "outcome_unknown" }]);
    expect(events.list("run").filter(event => event.payload.kind === "model.response.settled")).toHaveLength(1);
    expect(companion.conversation.history("taki")).toEqual([
      { role: "user", content: "Fixture" }, { role: "assistant", content: "partial" },
    ]);
  });
  it("persists one successful model lifecycle with authoritative detailed usage and measured timing", async () => {
    const { companion, events, lifecycle } = fixture();
    const agent = createChatAgent({
      model: streamingMockModel(["ok"]), store: companion.conversation, memory: companion.memory,
      effectLifecycle: lifecycle,
    });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }, { runId: "run", attemptId: "attempt" })))
      .resolves.toBe("ok");

    const runEvents = events.list("run");
    expect(runEvents.filter((event) => event.kind === "model.request.started")).toHaveLength(1);
    expect(runEvents.filter((event) => event.kind === "model.stream.first")).toHaveLength(1);
    expect(runEvents.filter((event) => event.kind === "model.response.settled")).toHaveLength(1);
    const usage = runEvents.find((event) => event.payload.kind === "usage.settled")?.payload;
    expect(usage).toMatchObject({
      quality: "reported", inputTokens: 3, inputTokenDetails: { noCacheTokens: 3 },
      outputTokens: 5, outputTokenDetails: { textTokens: 5 }, totalTokens: 8,
    });
    const settled = runEvents.find((event) => event.payload.kind === "model.response.settled")?.payload;
    expect(settled).toMatchObject({ outcome: "completed", finishReason: "stop" });
    expect(settled && "durationMs" in settled ? settled.durationMs : undefined).toBeGreaterThanOrEqual(0);
    expect(settled && "timeToFirstOutputMs" in settled ? settled.timeToFirstOutputMs : undefined).toBeGreaterThanOrEqual(0);
    expect(companion.db.prepare(`SELECT input_no_cache_tokens,cache_read_tokens,cache_write_tokens,
      output_text_tokens,reasoning_tokens,total_tokens FROM run_usage`).get()).toEqual({
      input_no_cache_tokens: 3, cache_read_tokens: null, cache_write_tokens: null,
      output_text_tokens: 5, reasoning_tokens: null, total_tokens: 8,
    });
  });

  it.each([
    { label: "provider failure", model: failingMockModel(new Error("provider failed")), outcome: "failed", errorCode: "provider_error" },
    { label: "interrupted stream", model: midStreamErrorModel(["partial"], new Error("stream failed")), outcome: "outcome_unknown", errorCode: "provider_stream_error" },
  ] as const)("settles $label exactly once", async ({ model, outcome, errorCode }) => {
    const { companion, events, lifecycle } = fixture();
    const agent = createChatAgent({ model, store: companion.conversation, memory: companion.memory, effectLifecycle: lifecycle });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }, { runId: "run", attemptId: "attempt" })))
      .rejects.toBeDefined();
    const settlements = events.list("run").filter((event) => event.payload.kind === "model.response.settled");
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.payload).toMatchObject({ outcome, errorCode });
    expect(events.list("run").filter((event) => event.payload.kind === "usage.settled")).toHaveLength(1);
  });

  it("isolates observer append failures from the model loop", async () => {
    const companion = createCompanionFixture(); fixtures.push(companion);
    const lifecycle = fakeLifecycle({ record: () => { throw new Error("observer failed"); } });
    const agent = createChatAgent({
      model: streamingMockModel(["ok"]), store: companion.conversation, memory: companion.memory,
      effectLifecycle: lifecycle,
    });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }, { runId: "run", attemptId: "attempt" })))
      .resolves.toBe("ok");
    expect(lifecycle.settle).toHaveBeenCalledOnce();
  });

  it("surfaces authoritative settlement failures after SDK telemetry callbacks", async () => {
    const companion = createCompanionFixture(); fixtures.push(companion);
    const lifecycle = fakeLifecycle({ settle: () => { throw new Error("settlement failed"); } });
    const agent = createChatAgent({
      model: streamingMockModel(["ok"]), store: companion.conversation, memory: companion.memory,
      effectLifecycle: lifecycle,
    });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }, { runId: "run", attemptId: "attempt" })))
      .rejects.toThrow("settlement failed");
  });

  it("uses the real SDK object bridge for reused call IDs, captured names, and pre-conversion failure outcomes", async () => {
    const { companion, events, lifecycle } = fixture();
    const model = scriptedModel([
      { kind: "tool", toolCallId: "reused", toolName: "echo", input: { privateInput: "not-in-events" } },
      { kind: "tool", toolCallId: "reused", toolName: "echo", input: { privateInput: "not-in-events" } },
      { kind: "tool", toolCallId: "reused", toolName: "echo", input: { privateInput: "not-in-events" } },
      { kind: "text", deltas: ["done"] },
    ]);
    const outputs = [
      { ok: true, content: [{ type: "text" as const, text: "one" }] },
      { isError: true, content: [{ type: "text" as const, text: "two" }] },
      { ok: false, code: "TOOL_FAILED", content: [{ type: "text" as const, text: "three" }] },
    ];
    let calls = 0;
    const capturedName = "名".repeat(240);
    const names = { echo: capturedName };
    const agent = createChatAgent({
      model, store: companion.conversation, memory: companion.memory, effectLifecycle: lifecycle,
      runContext: () => ({ toolDisplayNames: names, tools: {
        echo: tool({ inputSchema: z.object({ privateInput: z.string() }), execute: async () => {
          names.echo = "catalog replacement";
          return outputs[calls++]!;
        }, toModelOutput: ({ output }) => ({ type: "content", value: output.content }) }),
      } }),
    });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }, { runId: "run", attemptId: "attempt" })))
      .resolves.toBe("done");
    const ledger = events.list("run");
    const requests = ledger.filter((event) => event.payload.kind === "model.request.started")
      .map((event) => event.payload as Extract<typeof event.payload, { kind: "model.request.started" }>);
    const starts = ledger.filter((event) => event.payload.kind === "tool.call.started")
      .map((event) => event.payload as Extract<typeof event.payload, { kind: "tool.call.started" }>);
    const results = ledger.filter((event) => event.payload.kind === "tool.result.settled")
      .map((event) => event.payload as Extract<typeof event.payload, { kind: "tool.result.settled" }>);
    expect(calls).toBe(3);
    expect(new Set(requests.map((request) => request.callId)).size).toBe(1);
    expect(new Set(requests.map((request) => request.effectId)).size).toBe(4);
    expect(starts.map((start) => start.modelEffectId)).toEqual(requests.slice(0, 3).map((request) => request.effectId));
    expect(results.map((result) => result.invocationId)).toEqual(starts.map((start) => start.invocationId));
    expect(new Set(starts.map((start) => start.invocationId)).size).toBe(3);
    expect(results.map((result) => result.outcome)).toEqual(["completed", "failed", "failed"]);
    expect(results.every((result) => result.displayName === capturedName && result.startedAt !== undefined)).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain("not-in-events");
    expect(JSON.stringify(ledger)).not.toContain("catalog replacement");
  });
});

function fakeLifecycle(overrides: {
  record?: EffectLifecycleService["record"];
  settle?: EffectLifecycleService["settle"];
}): EffectLifecycleService {
  const effect: EffectLifecycle = {
    schemaVersion: "effect.v1", effectId: "effect", runId: "run", attemptId: "attempt", kind: "model",
    state: "intent_committed", version: 0, sourceRef: { type: "model", provider: "mock", modelId: "mock" },
    replayPosture: "never",
  };
  return {
    prepare: vi.fn(() => effect),
    settle: vi.fn(overrides.settle ?? (() => ({ effect, duplicate: false, stale: false }))),
    get: vi.fn(), unfinished: vi.fn(() => []), record: overrides.record,
  };
}
