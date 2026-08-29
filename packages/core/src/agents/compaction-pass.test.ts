import { afterEach, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
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

function fixture(opts: { estimated?: number; wall?: number; keep?: number; model?: LanguageModel; flushPort?: MemoryFlushPort } = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const timeline = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const autoState = createMemoryAutoRepo(db);
  const estimated = { value: opts.estimated ?? 90 };
  const flush = spyFlush();
  const { slot, model, ran } = fakeSlot(opts.model ?? (generatingModel("那段时间我们聊了很多。") as LanguageModel));
  const { logger, records } = createCaptureLogger();
  const deps: CompactionPassDeps = {
    view: { estimatedTokens: () => estimated.value, budget: () => opts.wall ?? 100 },
    timeline,
    summaries,
    flush: opts.flushPort ?? createLegacyMemoryFlushPort({ timeline, autoState, writer: flush.writer }),
    slot,
    config: { triggerRatio: 0.8, keepMessages: opts.keep ?? 3 },
    logger: logger.child({ mod: "compaction" }),
  };
  return { pass: createCompactionPass(deps), timeline, summaries, autoState, estimated, flush, model, ran, records };
}

function seed(timeline: ReturnType<typeof createTimelineRepo>, n: number): void {
  for (let i = 0; i < n; i += 1) timeline.append({ characterId: "taki", role: "user", content: `m${i + 1}` });
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
