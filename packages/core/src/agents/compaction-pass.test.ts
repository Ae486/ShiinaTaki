import { afterEach, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import type { FlushWriter } from "../memory/flush-writer.ts";
import { createLegacyMemoryFlushPort, type MemoryFlushPort } from "../memory/memory-flush-port.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";
import { toModelMessage } from "./turn-mapping.ts";
import { createConversationStore } from "./conversation-store.ts";
import { buildCompactionPrompt, createCompactionPass, type CompactionPassDeps } from "./compaction-pass.ts";
import { selectRetirementRange } from "./retirement-selector.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

/** A generate mock that records every prompt it receives (row 9: rolling input inspection). */
function recordingModel(text: string): { model: LanguageModel; prompts: string[] } {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      } as Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
    },
  });
  return { model: model as LanguageModel, prompts };
}

function controlledGenerateModel(text: string) {
  let startedResolve!: () => void;
  let releaseResolve!: () => void;
  let abortedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  const aborted = new Promise<void>((resolve) => { abortedResolve = resolve; });
  const model = new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      startedResolve();
      await new Promise<void>((resolve, reject) => {
        release.then(resolve);
        abortSignal?.addEventListener("abort", () => {
          abortedResolve();
          reject(abortSignal.reason);
        }, { once: true });
      });
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      } as Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
    },
  });
  return { model: model as LanguageModel, started, release: releaseResolve, aborted };
}

// A minimal slot double with a SWAPPABLE model and the never-rejects contract; `ran` records slot.run labels so
// sequencing tests can order flush vs summarize. Real-slot routing is covered by the fallback test below.
function fakeSlot(initial: LanguageModel): { slot: UtilitySlot; model: { value: LanguageModel }; ran: string[] } {
  const model = { value: initial };
  const ran: string[] = [];
  const slot: UtilitySlot = {
    get model() {
      return model.value;
    },
    run: async (label, task) => {
      ran.push(label);
      try {
        return await task();
      } catch {
        return undefined;
      }
    },
    usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }),
  };
  return { slot, model, ran };
}

interface SegmentCall {
  characterId: string;
  seqs: number[];
}

function spyFlush(): { calls: SegmentCall[]; failNext: { value: boolean }; writer: FlushWriter } {
  const calls: SegmentCall[] = [];
  const failNext = { value: false };
  return {
    calls,
    failNext,
    writer: {
      async run({ characterId, segment }) {
        calls.push({ characterId, seqs: segment.map((entry) => entry.seq) });
        if (failNext.value) throw new Error("flush llm down");
        return { writes: 0 };
      },
    },
  };
}

function fixture(opts: {
  estimated?: number; wall?: number; keep?: number; model?: LanguageModel; flushPort?: MemoryFlushPort;
  now?: () => Date; leaseMs?: number;
} = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const timeline = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const autoState = createMemoryAutoRepo(db);
  const operations = createCompactionOperationRepo(db);
  const estimated = { value: opts.estimated ?? 90 };
  const flush = spyFlush();
  const { slot, model, ran } = fakeSlot(opts.model ?? (generatingModel("那段时间我们聊了很多。") as LanguageModel));
  const { logger, records } = createCaptureLogger();
  const deps: CompactionPassDeps = {
    view: { estimatedTokens: () => estimated.value, budget: () => opts.wall ?? 100 },
    timeline,
    summaries,
    operations,
    flush: opts.flushPort ?? createLegacyMemoryFlushPort({ timeline, autoState, writer: flush.writer }),
    slot,
    config: { triggerRatio: 0.8, keepMessages: opts.keep ?? 3 },
    logger: logger.child({ mod: "compaction" }),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.leaseMs === undefined ? {} : { leaseMs: opts.leaseMs }),
  };
  return { db, pass: createCompactionPass(deps), timeline, summaries, operations, autoState, estimated, flush, model, ran, records };
}

function seed(timeline: ReturnType<typeof createTimelineRepo>, n: number): void {
  for (let i = 0; i < n; i += 1) timeline.append({ characterId: "taki", role: "user", content: `m${i + 1}` });
}

function seedToolSource(f: ReturnType<typeof fixture>) {
  seed(f.timeline, 10);
  // Fixed row identity/time make the pre-presentation v1 fingerprint an executable compatibility fixture.
  f.db.prepare("UPDATE timeline_messages SET id = printf('00000000-0000-4000-8000-%012d', seq), created_at = :at")
    .run({ at: "2026-09-06T00:00:00.000Z" });
  const call = [{ type: "tool-call", toolCallId: "c1", toolName: "opaque_route" }];
  const result = [{ type: "tool-result", toolCallId: "c1", toolName: "opaque_route", output: {
    type: "json", value: { text: "original result", displayName: "business label", input: "business input" },
  } }];
  const update = f.db.prepare("UPDATE timeline_messages SET role = :role, content = :content, parts = :parts WHERE seq = :seq");
  update.run({ seq: 2, role: "assistant", content: "[tool-call: opaque_route]", parts: JSON.stringify(call) });
  update.run({ seq: 3, role: "tool", content: "[tool-result: opaque_route -> json]", parts: JSON.stringify(result) });
  return { call, result };
}

describe("compaction trigger math (row 7 — fires above the ratio, never at or below)", () => {
  it("does nothing at or below triggerRatio × wall", async () => {
    for (const estimated of [79, 80]) {
      const f = fixture({ estimated });
      seed(f.timeline, 10);
      await f.pass.maybeRun("taki");

      expect(f.flush.calls).toHaveLength(0);
      expect(f.summaries.get("taki")).toBeNull();
      expect(f.ran).toHaveLength(0);
    }
  });

  it("fires strictly above the ratio and prices the retained tail instead of using keepMessages as the boundary", async () => {
    const f = fixture({ estimated: 81 });
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    // Each short row costs about 5 estimator units; retainRatio=0.16 of the 100-token wall keeps seqs 7..10.
    expect(f.summaries.get("taki")).toEqual({ throughSeq: 6, text: "那段时间我们聊了很多。" });
  });

  it("does nothing when fewer rows than the protected tail exist, even over the ratio", async () => {
    const f = fixture({ estimated: 99 });
    seed(f.timeline, 2);
    await f.pass.maybeRun("taki");

    expect(f.flush.calls).toHaveLength(0);
    expect(f.summaries.get("taki")).toBeNull();
  });

  it("does nothing when the boundary has not advanced past the existing summary", async () => {
    const f = fixture({ estimated: 99 });
    seed(f.timeline, 10);
    f.summaries.upsert({ characterId: "taki", throughSeq: 7, text: "已有记录" });
    await f.pass.maybeRun("taki");

    expect(f.flush.calls).toHaveLength(0);
    expect(f.ran).toHaveLength(0);
    expect(f.summaries.get("taki")).toEqual({ throughSeq: 7, text: "已有记录" });
  });
});

describe("compaction sequencing (row 8 — flush first, success-only advance, retry next trigger)", () => {
  it("flushes the retiring span BEFORE summarizing and advances the flush watermark to the boundary", async () => {
    const f = fixture();
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    expect(f.flush.calls).toEqual([{ characterId: "taki", seqs: [1, 2, 3, 4, 5, 6] }]);
    expect(f.ran).toEqual(["compact"]); // slot ran once, after the flush recorded its call
    expect(f.autoState.get("taki").lastFlushSeq).toBe(6);
    // Monotonicity (design §2.3): the summary never covers rows the flush has not seen.
    expect(f.summaries.get("taki")!.throughSeq).toBeLessThanOrEqual(f.autoState.get("taki").lastFlushSeq);
  });

  it("a flush failure defers the whole pass: no model call, no summary, retried on the next trigger", async () => {
    const f = fixture();
    seed(f.timeline, 10);
    f.flush.failNext.value = true;
    await f.pass.maybeRun("taki");

    expect(f.ran).toHaveLength(0);
    expect(f.summaries.get("taki")).toBeNull();
    expect(f.autoState.get("taki").lastFlushSeq).toBe(0);
    expect(f.records.some((r) => r.level === "warn" && r.msg === "pre-retire memory flush unavailable; compaction deferred")).toBe(true);

    f.flush.failNext.value = false;
    await f.pass.maybeRun("taki");
    expect(f.summaries.get("taki")?.throughSeq).toBe(6);
  });

  it("advances after an explicit not-required outcome", async () => {
    const f = fixture({
      flushPort: { prepareRetirement: async () => ({ status: "not_required", reason: "canonical_local_records_are_authoritative" }) },
    });
    seed(f.timeline, 10);

    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")?.throughSeq).toBe(6);
    expect(f.flush.calls).toHaveLength(0);
  });

  it("does not advance when a provider reports a successful flush below the retiring boundary", async () => {
    const f = fixture({
      flushPort: { prepareRetirement: async () => ({ status: "success", writes: 1, throughSeq: 2 }) },
    });
    seed(f.timeline, 10);

    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")).toBeNull();
    expect(f.ran).toHaveLength(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      level: "warn",
      obj: expect.objectContaining({ status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" }),
    }));
  });

  it("contains a throwing flush adapter as a bounded retryable failure", async () => {
    const f = fixture({
      flushPort: { prepareRetirement: async () => { throw new Error("provider secret must stay out of logs"); } },
    });
    seed(f.timeline, 10);

    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")).toBeNull();
    expect(f.ran).toHaveLength(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      level: "warn",
      obj: expect.objectContaining({ status: "retryable_failure", code: "MEMORY_FLUSH_FAILED" }),
    }));
    expect(JSON.stringify(f.records)).not.toContain("provider secret");
  });

  it("keeps the old summary authoritative when the provider is permanently unavailable", async () => {
    const f = fixture({
      flushPort: { prepareRetirement: async () => ({ status: "permanent_unavailable", code: "HINDSIGHT_RUNTIME_UNAVAILABLE" }) },
    });
    seed(f.timeline, 10);
    f.summaries.upsert({ characterId: "taki", throughSeq: 1, text: "authoritative old summary" });

    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")).toEqual({ throughSeq: 1, text: "authoritative old summary" });
    expect(f.ran).toHaveLength(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      level: "warn",
      obj: expect.objectContaining({ status: "permanent_unavailable", code: "HINDSIGHT_RUNTIME_UNAVAILABLE" }),
    }));
  });

  it("a generate failure warns, leaves through_seq unchanged, and the next trigger retries WITHOUT re-flushing", async () => {
    const f = fixture({ model: failingGenerateModel(new Error("provider down")) as LanguageModel });
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")).toBeNull(); // through advanced ONLY on full success
    expect(f.autoState.get("taki").lastFlushSeq).toBe(6); // the flush half did land — its own watermark holds it
    expect(f.records.some((r) => r.level === "warn" && r.msg === "summary generation failed; will retry")).toBe(true);

    f.model.value = generatingModel("恢复后的记录") as LanguageModel;
    await f.pass.maybeRun("taki");
    expect(f.summaries.get("taki")).toEqual({ throughSeq: 6, text: "恢复后的记录" });
    expect(f.flush.calls).toHaveLength(1); // the watermark guard prevented a double flush of the same span
  });

  it("an empty summary text is a failure, not an empty record", async () => {
    const f = fixture({ model: generatingModel("   ") as LanguageModel });
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")).toBeNull();
    expect(f.records.some((r) => r.level === "warn" && r.msg === "summary generation failed; will retry")).toBe(true);
  });

  it("logs one counts-only line on success (characterId/throughSeq/before/after — never text)", async () => {
    const f = fixture({ estimated: 90 });
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    const line = f.records.find((r) => r.msg === "conversation compacted");
    expect(line?.obj).toMatchObject({ characterId: "taki", throughSeq: 6, before: 90, after: 90 });
    expect(JSON.stringify(line)).not.toContain("那段时间");
  });
});

describe("durable compaction coordination (Slice 3)", () => {
  it("keeps replay and v1 Compaction identities byte-equivalent when only Timeline presentation changes", async () => {
    const f = fixture({ model: generatingModel("") as LanguageModel });
    seedToolSource(f);
    const store = createConversationStore({ repo: f.timeline });
    const replay = JSON.stringify(store.history("taki"));
    await f.pass.maybeRun("taki");
    const identities = f.db.prepare("SELECT operation_id,source_digest FROM conversation_compaction_operations").all();
    for (const [entryIndex, seq] of [2, 3].entries()) {
      f.db.prepare("UPDATE timeline_messages SET presentation=:presentation WHERE seq=:seq").run({ seq,
        presentation: JSON.stringify({ schemaVersion: "timeline-presentation.v1", messageId: "display-only",
          entryIndex, entryCount: 2, activitySeq: 7, references: [
            { kind: "tool", itemId: "immutable-invocation", order: 0, partIndex: 0, outcome: "outcome_unknown", message: "结果未确认" },
          ] }),
      });
    }
    expect(f.timeline.rangeAscending("taki", 1, 3).every((entry) => entry.presentation?.messageId === "display-only")).toBe(true);
    expect(JSON.stringify(store.history("taki"))).toBe(replay);
    await f.pass.maybeRun("taki");
    expect(f.db.prepare("SELECT operation_id,source_digest FROM conversation_compaction_operations").all()).toEqual(identities);
  });

  it("keeps v1 source and operation identities unchanged by tool display names", async () => {
    // Empty output leaves the same retiring range available for another attempt without advancing the summary.
    const f = fixture({ model: generatingModel("") as LanguageModel });
    const parts = seedToolSource(f);
    const identities = f.db.prepare("SELECT operation_id, source_digest FROM conversation_compaction_operations");
    await f.pass.maybeRun("taki");
    const baseline = identities.all();
    expect(baseline).toEqual([{
      operation_id: "compact:d8f6d0b7f9a57b46896b2e185d4134ab8bd53572af3faaac9ee449193ede5928",
      source_digest: "6c2e67bc09eb04ef28d735dd5d4a413ca1b7ea094d969ff83741ab9457cc0983",
    }]);

    const update = f.db.prepare("UPDATE timeline_messages SET parts = :parts WHERE seq = :seq");
    for (const displayName of ["Original server · tool", "Replacement display only"]) {
      update.run({ seq: 2, parts: JSON.stringify(parts.call.map((part) => ({ ...part, displayName }))) });
      update.run({ seq: 3, parts: JSON.stringify(parts.result.map((part) => ({ ...part, displayName }))) });
      await f.pass.maybeRun("taki");
      expect(identities.all()).toEqual(baseline);
      expect(f.summaries.get("taki")).toBeNull();
      expect(f.timeline.rangeAscending("taki", 1, 3).every((entry) =>
        entry.parts?.every((part) => "displayName" in part && part.displayName === displayName))).toBe(true);
    }
    expect(f.operations.get(String(baseline[0]?.operation_id))?.attemptNo).toBe(3);
  });

  it("accepts an in-flight change limited to tool display names without rewriting the Timeline", async () => {
    const controlled = controlledGenerateModel("canonical source summary");
    const f = fixture({ model: controlled.model });
    const parts = seedToolSource(f);
    const running = f.pass.maybeRun("taki");
    await controlled.started;
    const named = parts.result.map((part) => ({ ...part, displayName: "New display only" }));
    f.db.prepare("UPDATE timeline_messages SET parts = :parts WHERE seq = 3").run({ parts: JSON.stringify(named) });
    controlled.release();
    await running;

    expect(f.summaries.get("taki")).toEqual({ throughSeq: 6, text: "canonical source summary" });
    expect(f.timeline.rangeAscending("taki", 2, 3)[0]?.parts).toEqual(named);
    expect(f.db.prepare("SELECT state FROM conversation_compaction_operations").get()).toEqual({ state: "committed" });
  });

  it.each(["content", "output"])("still rejects changed canonical transcript %s with named tools", async (field) => {
    const controlled = controlledGenerateModel("must be discarded");
    const f = fixture({ model: controlled.model });
    const parts = seedToolSource(f);
    const named = parts.result.map((part) => ({ ...part, displayName: "Original server · tool" }));
    const update = f.db.prepare("UPDATE timeline_messages SET parts = :parts WHERE seq = 3");
    update.run({ parts: JSON.stringify(named) });
    const running = f.pass.maybeRun("taki");
    await controlled.started;
    if (field === "content") {
      f.db.prepare("UPDATE timeline_messages SET content = :content WHERE seq = 1").run({ content: "changed dialogue" });
    } else {
      // A displayName inside the business output is canonical data, unlike the tool part's UI-only label.
      update.run({ parts: JSON.stringify(named.map((part) => ({ ...part, output: {
        ...part.output, value: { ...part.output.value, displayName: "changed business result" },
      } }))) });
    }
    controlled.release();
    await running;
    expect(f.summaries.get("taki")).toBeNull();
    const operation = f.db.prepare("SELECT operation_id FROM conversation_compaction_operations").get();
    expect(f.operations.get(String(operation?.operation_id))).toMatchObject({ state: "failed", failureCode: "SOURCE_STALE" });
  });

  it("accepts a concurrent append strictly after the captured retiring range", async () => {
    const controlled = controlledGenerateModel("captured range summary");
    const f = fixture({ model: controlled.model });
    seed(f.timeline, 10);

    const running = f.pass.maybeRun("taki");
    await controlled.started;
    const appended = f.timeline.append({ characterId: "taki", role: "user", content: "arrived during summary" });
    controlled.release();
    await running;

    expect(appended.seq).toBe(11);
    expect(f.summaries.get("taki")).toEqual({ throughSeq: 6, text: "captured range summary" });
    expect(f.timeline.latestSeq("taki")).toBe(11);
    expect(f.timeline.rangeAscending("taki", 6, 11).map((entry) => entry.seq)).toEqual([7, 8, 9, 10, 11]);
  });

  it("rejects a generated summary when the captured source range changes", async () => {
    const controlled = controlledGenerateModel("must be discarded");
    const f = fixture({ model: controlled.model });
    seed(f.timeline, 10);

    const running = f.pass.maybeRun("taki");
    await controlled.started;
    f.timeline.deleteEntry("taki", 3);
    controlled.release();
    await running;

    expect(f.summaries.get("taki")).toBeNull();
    const operation = f.db.prepare("SELECT operation_id FROM conversation_compaction_operations").get();
    expect(f.operations.get(String(operation?.operation_id))).toMatchObject({ state: "failed", failureCode: "SOURCE_STALE" });
  });

  it("rejects a competing summary revision and preserves the newer checkpoint", async () => {
    const controlled = controlledGenerateModel("stale generated summary");
    const f = fixture({ model: controlled.model });
    seed(f.timeline, 10);

    const running = f.pass.maybeRun("taki");
    await controlled.started;
    f.summaries.upsert({ characterId: "taki", throughSeq: 2, text: "competing summary" });
    controlled.release();
    await running;

    expect(f.summaries.get("taki")).toEqual({ throughSeq: 2, text: "competing summary" });
    expect(f.db.prepare("SELECT state,failure_code FROM conversation_compaction_operations").get()).toEqual({
      state: "failed",
      failure_code: "SUMMARY_CONFLICT",
    });
  });

  it("deduplicates direct competing triggers with the durable Character lease", async () => {
    const controlled = controlledGenerateModel("only once");
    const f = fixture({ model: controlled.model });
    seed(f.timeline, 10);

    const first = f.pass.maybeRun("taki");
    await controlled.started;
    const duplicate = f.pass.maybeRun("taki");
    await duplicate;
    controlled.release();
    await first;

    expect(f.ran).toEqual(["compact"]);
    expect(f.db.prepare("SELECT count(*) AS count FROM conversation_compaction_operations").get()?.count).toBe(1);
    expect(f.summaries.get("taki")?.throughSeq).toBe(6);
  });

  it("durably cancels the auxiliary model call without advancing throughSeq", async () => {
    const controlled = controlledGenerateModel("late summary");
    const f = fixture({ model: controlled.model });
    seed(f.timeline, 10);

    const running = f.pass.maybeRun("taki");
    await controlled.started;
    expect(f.pass.cancel("taki")).toBe(true);
    await running;

    expect(f.summaries.get("taki")).toBeNull();
    expect(f.autoState.get("taki").lastFlushSeq).toBe(6);
    expect(f.db.prepare("SELECT state FROM conversation_compaction_operations").get()?.state).toBe("cancelled");
    expect(f.db.prepare("SELECT kind FROM conversation_compaction_events ORDER BY operation_seq").all().map((row) => row.kind))
      .toEqual(["started", "flush_completed", "cancelled"]);
  });

  it("keeps the replacement attempt's cancellation controller when a stale same-operation attempt settles", async () => {
    let clock = new Date("2026-08-30T00:00:00.000Z");
    const firstModel = controlledGenerateModel("stale first result");
    const secondModel = controlledGenerateModel("cancelled replacement result");
    const f = fixture({ model: firstModel.model, now: () => clock, leaseMs: 1_000 });
    seed(f.timeline, 10);

    const first = f.pass.maybeRun("taki");
    await firstModel.started;
    clock = new Date("2026-08-30T00:00:02.000Z");
    f.model.value = secondModel.model;
    const replacement = f.pass.maybeRun("taki");
    await secondModel.started;

    firstModel.release();
    await first;
    expect(f.pass.cancel("taki")).toBe(true);
    const aborted = await Promise.race([
      secondModel.aborted.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    secondModel.release();
    await replacement;

    expect(aborted).toBe(true);
    expect(f.summaries.get("taki")).toBeNull();
    expect(f.db.prepare("SELECT state,attempt_no,lease_fence FROM conversation_compaction_operations").get()).toEqual({
      state: "cancelled",
      attempt_no: 2,
      lease_fence: 2,
    });
  });

  it("keeps Timeline scroll-back byte-equal and makes the replacement Replay View deterministic", async () => {
    const f = fixture();
    seed(f.timeline, 10);
    const before = f.timeline.latestAscending("taki", 20);

    await f.pass.maybeRun("taki");

    expect(f.timeline.latestAscending("taki", 20)).toEqual(before);
    const store = createConversationStore({ repo: f.timeline, summaries: f.summaries, window: { budget: () => 100 } });
    const first = store.history("taki");
    expect(store.history("taki")).toEqual(first);
    expect(JSON.stringify(first)).toContain("<conversation-summary>");
  });

  it("keeps durable checkpoints and operation evidence isolated by Character", async () => {
    const f = fixture();
    seed(f.timeline, 10);
    for (let index = 1; index <= 10; index += 1) {
      f.timeline.append({ characterId: "yui", role: "user", content: `y${index}` });
    }

    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")?.throughSeq).toBe(6);
    expect(f.summaries.get("yui")).toBeNull();
    expect(f.operations.active("yui")).toBeNull();
    expect(f.db.prepare("SELECT DISTINCT character_id FROM conversation_compaction_operations").all())
      .toEqual([{ character_id: "taki" }]);
  });
});

describe("token-priced retirement selection", () => {
  it("does not move the ordinary boundary when only the minimum-tail row guard changes", () => {
    const f = fixture();
    seed(f.timeline, 10);
    const entries = f.timeline.latestAscending("taki", 20);

    expect(selectRetirementRange(entries, 16, 1)?.newThroughSeq).toBe(6);
    expect(selectRetirementRange(entries, 16, 3)?.newThroughSeq).toBe(6);
  });

  it("keeps a complete multi-call and multi-result span together", () => {
    const f = fixture();
    f.timeline.append({ characterId: "taki", role: "user", content: "old" });
    f.timeline.append({
      characterId: "taki",
      role: "assistant",
      content: "[tool-call: exec]",
      parts: [
        { type: "tool-call", toolCallId: "c1", toolName: "exec" },
        { type: "tool-call", toolCallId: "c2", toolName: "exec" },
      ],
    });
    f.timeline.append({
      characterId: "taki",
      role: "tool",
      content: "[tool-result: exec -> text]",
      parts: [{ type: "tool-result", toolCallId: "c1", toolName: "exec", output: { type: "text", value: "one" } }],
    });
    f.timeline.append({
      characterId: "taki",
      role: "tool",
      content: "[tool-result: exec -> text]",
      parts: [{ type: "tool-result", toolCallId: "c2", toolName: "exec", output: { type: "text", value: "two" } }],
    });
    f.timeline.append({ characterId: "taki", role: "user", content: "new" });

    const entries = f.timeline.latestAscending("taki", 20);
    const newestCost = entryEstimate(entries.at(-1)!);
    const selection = selectRetirementRange(entries, newestCost + 1, 1);

    expect(selection?.newThroughSeq).toBe(1);
    expect(selection?.retainedEntries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5]);
  });

  it("keeps duplicate or name-mismatched results atomic instead of cutting after the first result", () => {
    const f = fixture();
    f.timeline.append({ characterId: "taki", role: "user", content: "old" });
    f.timeline.append({
      characterId: "taki",
      role: "assistant",
      content: "[tool-call: exec]",
      parts: [{ type: "tool-call", toolCallId: "c1", toolName: "exec" }],
    });
    for (const toolName of ["exec", "other"]) {
      f.timeline.append({
        characterId: "taki",
        role: "tool",
        content: `[tool-result: ${toolName} -> text]`,
        parts: [{ type: "tool-result", toolCallId: "c1", toolName, output: { type: "text", value: toolName } }],
      });
    }
    f.timeline.append({ characterId: "taki", role: "user", content: "new" });

    const entries = f.timeline.latestAscending("taki", 20);
    const newestCost = entryEstimate(entries.at(-1)!);
    const selection = selectRetirementRange(entries, newestCost + 1, 1);

    expect(selection?.newThroughSeq).toBe(1);
    expect(selection?.retainedEntries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5]);
  });

  it("retains an oversized newest unit while still retiring older rows", () => {
    const f = fixture();
    f.timeline.append({ characterId: "taki", role: "user", content: "old" });
    f.timeline.append({ characterId: "taki", role: "user", content: "x".repeat(2_000) });

    const selection = selectRetirementRange(f.timeline.latestAscending("taki", 20), 1, 1);

    expect(selection?.newThroughSeq).toBe(1);
    expect(selection?.retainedEntries.map((entry) => entry.seq)).toEqual([2]);
  });
});

describe("compaction rolling input (row 9 — old summary + retiring span, tail protected, no length cut)", () => {
  it("feeds the prompt the EARLIER RECORD and exactly the retiring span, never the protected tail", async () => {
    const recorder = recordingModel("新的合并记录");
    const f = fixture({ model: recorder.model });
    seed(f.timeline, 10);
    f.summaries.upsert({ characterId: "taki", throughSeq: 2, text: "旧的记录：他答应过请我吃拉面" });
    await f.pass.maybeRun("taki");

    const prompt = recorder.prompts[0]!;
    expect(prompt).toContain("EARLIER RECORD:");
    // Date anchor (owner 2026-08-02, post-probe): present, and BEFORE the material it anchors.
    expect(prompt).toMatch(/Today is \w+, \d{4}-\d{2}-\d{2}\./);
    expect(prompt.indexOf("Today is")).toBeLessThan(prompt.indexOf("EARLIER RECORD:"));
    expect(prompt).toContain("旧的记录：他答应过请我吃拉面");
    expect(prompt).toContain("WHAT HAPPENED SINCE:");
    // Span = (oldThrough 2, newThrough 6]: m3..m6 — nothing before, nothing from the retained tail m7..m10.
    expect(prompt).toContain("user: m3");
    expect(prompt).toContain("user: m6");
    expect(prompt).not.toContain("user: m2");
    expect(prompt).not.toContain("user: m7");
    expect(f.summaries.get("taki")).toEqual({ throughSeq: 6, text: "新的合并记录" });
  });

  it("a first compaction states there is no earlier record", async () => {
    const recorder = recordingModel("第一次的记录");
    const f = fixture({ model: recorder.model });
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    expect(recorder.prompts[0]).toContain("(none — this is the first time)");
  });

  it("NEVER truncates the model's text — the stored summary is byte-identical however long (owner ruling)", async () => {
    const long = "这段记录非常长。".repeat(4000); // ~32k chars — far beyond any plausible cap
    const f = fixture({ model: generatingModel(long) as LanguageModel });
    seed(f.timeline, 10);
    await f.pass.maybeRun("taki");

    expect(f.summaries.get("taki")!.text).toBe(long);
  });

  it("buildCompactionPrompt carries the system-reminder framing, the R10 voice fragment and the date anchor", () => {
    const prompt = buildCompactionPrompt(null, "user: 你好", new Date(2026, 7, 2));
    expect(prompt).toContain("<system-reminder>");
    expect(prompt).toContain("You are NOT the primary agent");
    expect(prompt).toContain("FIRST PERSON"); // MEMORY_VOICE_RULE imported whole (R10, tidy precedent)
    expect(prompt).toContain("WHAT MUST SURVIVE");
    expect(prompt).toContain("Permanent facts about them"); // amendment (b): the §3.2b drop line
    expect(prompt).toContain("Every word\nshould enable future continuity"); // amendment (a): Letta closer, no token target
    expect(prompt).not.toContain("Aim for about");
    // Post-probe owner ruling: the input carries the base-prompt day line — the probe showed the model inventing a
    // year when the material has month-day anchors only (Hermes TEMPORAL ANCHORING).
    expect(prompt).toMatch(/Today is \w+, 2026-08-02\./);
  });
});

function entryEstimate(entry: Parameters<typeof toModelMessage>[0]): number {
  const message = toModelMessage(entry);
  return message === null ? 0 : estimateMessageTokens(message);
}

describe("compaction on the real utility slot (row 11 — slot model used; main-model fallback)", () => {
  it("with no utility provider configured the pass generates on the MAIN model via the slot", async () => {
    const { logger } = createCaptureLogger();
    const slot = createUtilitySlot({ mainModel: generatingModel("主模型写下的记录") as LanguageModel, logger });
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const timeline = createTimelineRepo(db);
    const summaries = createSummaryRepo(db);
    const autoState = createMemoryAutoRepo(db);
    const pass = createCompactionPass({
      view: { estimatedTokens: () => 90, budget: () => 100 },
      timeline,
      summaries,
      operations: createCompactionOperationRepo(db),
      flush: createLegacyMemoryFlushPort({ timeline, autoState, writer: spyFlush().writer }),
      slot,
      config: { triggerRatio: 0.8, keepMessages: 3 },
      logger: createCaptureLogger().logger.child({ mod: "compaction" }),
    });
    seed(timeline, 10);
    await pass.maybeRun("taki");

    expect(summaries.get("taki")).toEqual({ throughSeq: 6, text: "主模型写下的记录" });
    expect(slot.usage().calls).toBe(1); // the generation ran THROUGH the slot (serial chain + accounting)
  });
});
