import { afterEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { createAutoMemory, type AutoMemoryLogger } from "./auto-memory.ts";
import { createEpisodicWriter } from "./episodic-writer.ts";
import type { EpisodicWriter } from "./episodic-writer.ts";
import type { FlushWriter } from "./flush-writer.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

interface SegmentInput {
  characterId: string;
  segment: Array<{ seq: number; content: string }>;
}

// A recording episodic writer whose failure is togglable (proves the retry-on-next-trigger policy).
function spyEpisodic(): { calls: SegmentInput[]; failNext: { value: boolean }; writer: EpisodicWriter } {
  const calls: SegmentInput[] = [];
  const failNext = { value: false };
  return {
    calls,
    failNext,
    writer: {
      async summarize({ characterId, segment }) {
        calls.push({ characterId, segment: segment.map((e) => ({ seq: e.seq, content: e.content })) });
        if (failNext.value) throw new Error("llm down");
        return { entryIds: ["0001-episode"] };
      },
    },
  };
}

function spyFlush(): { calls: SegmentInput[]; writer: FlushWriter } {
  const calls: SegmentInput[] = [];
  return {
    calls,
    writer: {
      async run({ characterId, segment }) {
        calls.push({ characterId, segment: segment.map((e) => ({ seq: e.seq, content: e.content })) });
      },
    },
  };
}

function captureLogger(): { infos: Array<Record<string, unknown>>; warns: Array<Record<string, unknown>>; logger: AutoMemoryLogger } {
  const infos: Array<Record<string, unknown>> = [];
  const warns: Array<Record<string, unknown>> = [];
  return {
    infos,
    warns,
    logger: {
      info: (obj) => void infos.push(obj as Record<string, unknown>),
      warn: (obj) => void warns.push(obj as Record<string, unknown>),
    },
  };
}

// Seed `n` timeline rows for taki through the real conversation store (same db the repos read).
function seed(f: CompanionFixture, n: number): void {
  for (let i = 0; i < n; i += 1) f.conversation.appendUser("taki", `m${i + 1}`);
}

function wire(f: CompanionFixture, w: { episodic: EpisodicWriter; flush: FlushWriter; logger: AutoMemoryLogger }) {
  const timeline = createTimelineRepo(f.db);
  const autoState = createMemoryAutoRepo(f.db);
  return { autoState, auto: createAutoMemory({ timeline, autoState, ...w }) };
}

describe("auto-memory episodic trigger (T2/T3/T4)", () => {
  it("does nothing below the 20-message threshold (T2)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    const fl = spyFlush();
    const { autoState, auto } = wire(f, { episodic: ep.writer, flush: fl.writer, logger: captureLogger().logger });
    seed(f, 19);

    await auto.onTurnCompleted("taki");

    expect(ep.calls).toHaveLength(0);
    expect(fl.calls).toHaveLength(0);
    expect(autoState.get("taki").lastEpisodicSeq).toBe(0);
  });

  it("fires exactly once when crossing 20, over the whole segment, and advances the watermark (T3)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    const { autoState, auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: captureLogger().logger });
    seed(f, 20);

    // Double trigger: the second must read the advanced watermark and do nothing (one write set).
    await auto.onTurnCompleted("taki");
    await auto.onTurnCompleted("taki");

    expect(ep.calls).toHaveLength(1);
    expect(ep.calls[0]?.segment.map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20);
  });

  it("on LLM failure keeps the watermark and warns, then retries on the next trigger (T4)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    ep.failNext.value = true;
    const cap = captureLogger();
    const { autoState, auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: cap.logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");
    expect(ep.calls).toHaveLength(1);
    expect(autoState.get("taki").lastEpisodicSeq).toBe(0); // NOT advanced
    expect(cap.warns.some((w) => w.kind === "episodic")).toBe(true);

    ep.failNext.value = false; // provider recovers
    await auto.onTurnCompleted("taki");
    expect(ep.calls).toHaveLength(2); // retried the same segment
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20);
  });

  it("lands real episode entries on disk via the store when wired to the real writer (T3 file+index)", async () => {
    const f = fresh();
    const episodic = createEpisodicWriter({
      model: generatingModel(JSON.stringify([{ content: "聊了很久关于旅行的事", importance: 6 }])),
      writeEpisode: (input) => f.memory.writeEntry({ ...input, type: "episodes" }),
    });
    const { auto } = wire(f, { episodic, flush: spyFlush().writer, logger: captureLogger().logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");

    const files = readdirSync(join(f.root, "memory"), { recursive: true }).filter(
      (p): p is string => typeof p === "string" && p.includes("episodes") && p.endsWith(".md"),
    );
    expect(files).toHaveLength(1);
  });
});

describe("auto-memory flush trigger (T5/T7)", () => {
  it("no-op until latestSeq - REPLAY_WINDOW exceeds the flush watermark, then fires over the leaving segment (T5)", async () => {
    const f = fresh();
    const fl = spyFlush();
    const { autoState, auto } = wire(f, { episodic: spyEpisodic().writer, flush: fl.writer, logger: captureLogger().logger });

    seed(f, 200); // latest 200, through = 0 -> no flush yet
    await auto.onTurnCompleted("taki");
    expect(fl.calls).toHaveLength(0);
    expect(autoState.get("taki").lastFlushSeq).toBe(0);

    seed(f, 1); // latest 201, through = 1 > 0 -> fire over (0, 1]
    await auto.onTurnCompleted("taki");
    expect(fl.calls).toHaveLength(1);
    expect(fl.calls[0]?.segment.map((e) => e.seq)).toEqual([1]);
    expect(autoState.get("taki").lastFlushSeq).toBe(1);
  });

  it("does not re-flush an already-flushed segment when no new messages arrive (T7 double-flush guard)", async () => {
    const f = fresh();
    const fl = spyFlush();
    const { auto } = wire(f, { episodic: spyEpisodic().writer, flush: fl.writer, logger: captureLogger().logger });
    seed(f, 201);

    await auto.onTurnCompleted("taki");
    await auto.onTurnCompleted("taki"); // no new messages
    expect(fl.calls).toHaveLength(1);
  });
});

describe("auto-memory mutex (T8)", () => {
  it("serializes overlapping triggers so the LLM fires only once", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    const { auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: captureLogger().logger });
    seed(f, 20);

    // Two triggers launched before the first resolves: without the per-character mutex both would read watermark 0.
    const p1 = auto.onTurnCompleted("taki");
    const p2 = auto.onTurnCompleted("taki");
    await Promise.all([p1, p2]);

    expect(ep.calls).toHaveLength(1);
  });

  it("serializes three overlapping triggers and still resets so a later trigger fires (tail cleanup)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    const { auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: captureLogger().logger });
    seed(f, 20);

    // Three triggers queued back-to-back: the mutex chain must serialize them; only the first sees an un-advanced
    // watermark, so exactly one write set lands (a lost serialization would double-fire).
    await Promise.all([auto.onTurnCompleted("taki"), auto.onTurnCompleted("taki"), auto.onTurnCompleted("taki")]);
    expect(ep.calls).toHaveLength(1);

    // After the chain drains its map entry must be gone: a fresh trigger over new messages summarizes again (no wedge).
    seed(f, 20); // latest now 40, watermark at 20 -> crosses the threshold again
    await auto.onTurnCompleted("taki");
    expect(ep.calls).toHaveLength(2);
    expect(ep.calls[1]?.segment.map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 21));
  });
});
