import { afterEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createConversationStore } from "../agents/conversation-store.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { MemoryEvent, MemoryEventsRepo } from "../db/memory-events-repo.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { createAutoMemory, type AutoMemoryCompact, type AutoMemoryLogger, type AutoMemoryTidy } from "./auto-memory.ts";
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

// A recording episodic writer whose failure and its returned entry ids are both togglable (the empty return is
// the T5-R15 normal outcome, which must be distinguishable from a broken writer — hence the skip event).
function spyEpisodic(): {
  calls: SegmentInput[];
  failNext: { value: boolean };
  entryIds: { value: string[] };
  writer: EpisodicWriter;
} {
  const calls: SegmentInput[] = [];
  const failNext = { value: false };
  const entryIds = { value: ["0001-episode"] };
  return {
    calls,
    failNext,
    entryIds,
    writer: {
      async summarize({ characterId, segment }) {
        calls.push({ characterId, segment: segment.map((e) => ({ seq: e.seq, content: e.content })) });
        if (failNext.value) throw new Error("llm down");
        return { entryIds: entryIds.value };
      },
    },
  };
}

// The event log seam: a capturing double (the real repo is exercised in db/memory-events-repo.test.ts).
function spyEvents(): { records: MemoryEvent[]; repo: MemoryEventsRepo } {
  const records: MemoryEvent[] = [];
  return {
    records,
    repo: {
      record: (event) => void records.push(event),
      listByCharacter: () => [],
    },
  };
}

// A recording flush writer whose reported write count is togglable (zero writes is the T5-R15 normal outcome).
function spyFlush(): { calls: SegmentInput[]; writes: { value: number }; writer: FlushWriter } {
  const calls: SegmentInput[] = [];
  const writes = { value: 1 };
  return {
    calls,
    writes,
    writer: {
      async run({ characterId, segment }) {
        calls.push({ characterId, segment: segment.map((e) => ({ seq: e.seq, content: e.content })) });
        return { writes: writes.value };
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

function wire(
  f: CompanionFixture,
  w: {
    episodic: EpisodicWriter;
    flush: FlushWriter;
    logger: AutoMemoryLogger;
    tidy?: AutoMemoryTidy;
    compact?: AutoMemoryCompact;
    windowStart?: (characterId: string) => number;
  },
) {
  const timeline = createTimelineRepo(f.db);
  const autoState = createMemoryAutoRepo(f.db);
  const events = spyEvents();
  // Default boundary = the fixture's legacy store (no token budget): identical to the old latest-REPLAY_WINDOW math.
  const windowStart = w.windowStart ?? ((characterId: string) => f.conversation.windowStart(characterId));
  return {
    autoState,
    events,
    auto: createAutoMemory({ timeline, autoState, events: events.repo, ...w, windowStart }),
  };
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
      model: generatingModel(JSON.stringify([{ layer: "episodes", content: "聊了很久关于旅行的事", importance: 6 }])),
      writeMemory: ({ layer, ...rest }) => f.memory.writeEntry({ ...rest, type: layer }),
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

describe("auto-memory write-gate skip log (T5-R15)", () => {
  it("records a skip event exactly when the episodic writer kept nothing", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    ep.entryIds.value = []; // the gate found nothing worth keeping — the normal outcome, not a failure
    const { autoState, events, auto } = wire(f, {
      episodic: ep.writer,
      flush: spyFlush().writer,
      logger: captureLogger().logger,
    });
    seed(f, 20);

    await auto.onTurnCompleted("taki");

    // Silence must leave a trace, or "nothing was worth writing" and "the writer is broken" look identical.
    expect(events.records).toEqual([{ kind: "skip", characterId: "taki", turnSeq: 20 }]);
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20); // a skip still advances the watermark
  });

  it("records NO skip event when the writer kept something", async () => {
    const f = fresh();
    const ep = spyEpisodic(); // default: one entry written
    const { events, auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: captureLogger().logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");
    expect(events.records).toEqual([]);
  });

  it("records no skip event when the pass FAILED (a failure is not a skip — it retries)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    ep.failNext.value = true;
    const { events, auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: captureLogger().logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");
    expect(events.records).toEqual([]);
  });

  it("records a skip event for the FLUSH half of the gate too, keyed to the segment it judged", async () => {
    const f = fresh();
    const fl = spyFlush();
    fl.writes.value = 0; // the flush turn called memory_write zero times
    const { events, auto } = wire(f, { episodic: spyEpisodic().writer, flush: fl.writer, logger: captureLogger().logger });
    seed(f, 201); // latest 201, through = 1 -> the flush fires over (0, 1]

    await auto.onTurnCompleted("taki");

    // Both halves of the write gate must be equally observable; the episodic half wrote, so only flush skipped.
    expect(events.records).toEqual([{ kind: "skip", characterId: "taki", turnSeq: 1 }]);
  });

  it("records NO skip event when the flush kept something", async () => {
    const f = fresh();
    const fl = spyFlush(); // default: one write
    const { events, auto } = wire(f, { episodic: spyEpisodic().writer, flush: fl.writer, logger: captureLogger().logger });
    seed(f, 201);

    await auto.onTurnCompleted("taki");
    expect(events.records).toEqual([]);
  });
});

describe("auto-memory turn origin seam (M-A2)", () => {
  it("defaults to 'primary' and carries the caller's origin into the log fields", async () => {
    const f = fresh();
    const cap = captureLogger();
    const { auto } = wire(f, { episodic: spyEpisodic().writer, flush: spyFlush().writer, logger: cap.logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");
    expect(cap.infos.find((i) => i.kind === "episodic")?.origin).toBe("primary");

    seed(f, 20);
    await auto.onTurnCompleted("taki", "heartbeat"); // T4 fills real values; T5 only carries them
    expect(cap.infos.filter((i) => i.kind === "episodic").at(-1)?.origin).toBe("heartbeat");
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

describe("auto-memory flush boundary == history boundary (batch 6 coupling point 2)", () => {
  it("with a token-windowed store the flush covers EXACTLY the rows history() no longer replays", async () => {
    const f = fresh();
    const fl = spyFlush();
    // A second store over the SAME timeline, with a token budget: each "mN" row costs 5 estimator units, so a
    // budget of 20 replays the newest 4 rows. Production wires this exact shape (calibrator × historyRatio).
    const windowed = createConversationStore({ repo: createTimelineRepo(f.db), window: { budget: () => 20 } });
    const { auto } = wire(f, {
      episodic: spyEpisodic().writer,
      flush: fl.writer,
      logger: captureLogger().logger,
      windowStart: (id) => windowed.windowStart(id),
    });
    seed(f, 30);

    await auto.onTurnCompleted("taki");

    // Both paths, same fixture: the replay begins at windowStart and the flush segment ends one row below it.
    const boundary = windowed.windowStart("taki");
    expect(windowed.history("taki")).toHaveLength(30 - boundary + 1);
    expect(fl.calls).toHaveLength(1);
    expect(fl.calls[0]?.segment.map((e) => e.seq)).toEqual(Array.from({ length: boundary - 1 }, (_, i) => i + 1));
    expect(fl.calls[0]?.segment.at(-1)?.seq).toBe(boundary - 1);
  });

  it("under the legacy store (no budget) the flush stays byte-identical to the old REPLAY_WINDOW math", async () => {
    const f = fresh();
    const fl = spyFlush();
    const { auto } = wire(f, { episodic: spyEpisodic().writer, flush: fl.writer, logger: captureLogger().logger });
    seed(f, 205); // legacy window = seqs 6..205 -> the leaving segment is (0, 5]

    await auto.onTurnCompleted("taki");

    expect(fl.calls[0]?.segment.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("with a summary substituted the boundary equality still holds: retired rows have left the flush window (batch 7)", async () => {
    const f = fresh();
    const fl = spyFlush();
    const timeline = createTimelineRepo(f.db);
    const summaries = createSummaryRepo(f.db);
    const windowed = createConversationStore({ repo: timeline, summaries, window: { budget: () => 1_000_000 } });
    const { auto } = wire(f, {
      episodic: spyEpisodic().writer,
      flush: fl.writer,
      logger: captureLogger().logger,
      windowStart: (id) => windowed.windowStart(id),
    });
    seed(f, 30);
    // The compactor's shape: rows 1..26 retired into the summary (through=26), flush watermark NOT yet advanced
    // here — so the auto-memory flush must sweep exactly the retired span the view no longer replays.
    summaries.upsert({ characterId: "taki", throughSeq: 26, text: "早前的对话已折叠" });

    await auto.onTurnCompleted("taki");

    const boundary = windowed.windowStart("taki");
    expect(boundary).toBe(27); // first LIVE seq — substitution moved the boundary, not the token cut
    expect(windowed.history("taki")[0]?.content).toContain("<conversation-summary>");
    expect(windowed.history("taki")).toHaveLength(30 - boundary + 2); // head + live rows
    expect(fl.calls[0]?.segment.map((e) => e.seq)).toEqual(Array.from({ length: boundary - 1 }, (_, i) => i + 1));
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

describe("auto-memory tidy seam (batch 4a: additive, absent = unchanged)", () => {
  function spyTidy(): { calls: string[]; failNext: { value: boolean }; tidy: AutoMemoryTidy } {
    const calls: string[] = [];
    const failNext = { value: false };
    return {
      calls,
      failNext,
      tidy: {
        async maybeRun(characterId) {
          calls.push(characterId);
          if (failNext.value) throw new Error("tidy exploded");
        },
      },
    };
  }

  it("calls the hook once per pass, after the write passes, inside the same chain", async () => {
    const f = fresh();
    const order: string[] = [];
    const ep = spyEpisodic();
    const tidy: AutoMemoryTidy = {
      async maybeRun() {
        order.push("tidy");
      },
    };
    const flush: FlushWriter = {
      async run() {
        order.push("flush");
        return { writes: 0 };
      },
    };
    const { auto } = wire(f, { episodic: ep.writer, flush, logger: captureLogger().logger, tidy });
    seed(f, 201); // crosses both the episodic and the flush thresholds

    await auto.onTurnCompleted("taki");

    // The pass judges a store the writers have finished with; ordering is what makes it need no mutex of its own.
    expect(order).toEqual(["flush", "tidy"]);
  });

  it("runs even on a turn where neither write pass fired (the trigger decides for itself)", async () => {
    const f = fresh();
    const t = spyTidy();
    const { auto } = wire(f, {
      episodic: spyEpisodic().writer,
      flush: spyFlush().writer,
      logger: captureLogger().logger,
      tidy: t.tidy,
    });
    seed(f, 3); // below every write threshold

    await auto.onTurnCompleted("taki");
    expect(t.calls).toEqual(["taki"]);
  });

  it("with NO tidy dep the pass behaves exactly as before (byte-identical write path)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    const cap = captureLogger();
    const { autoState, auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: cap.logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");

    expect(ep.calls).toHaveLength(1);
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20);
    expect(cap.warns).toEqual([]);
  });

  it("a failing tidy warns and never breaks the turn's write passes", async () => {
    const f = fresh();
    const t = spyTidy();
    t.failNext.value = true;
    const ep = spyEpisodic();
    const cap = captureLogger();
    const { autoState, auto } = wire(f, {
      episodic: ep.writer,
      flush: spyFlush().writer,
      logger: cap.logger,
      tidy: t.tidy,
    });
    seed(f, 20);

    await expect(auto.onTurnCompleted("taki")).resolves.toBeUndefined();
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20); // the episodic write still landed
    expect(cap.warns.some((w) => w.kind === "tidy")).toBe(true);
  });
});

describe("auto-memory compact seam (batch 7b: additive, runs LAST, absent = unchanged)", () => {
  function spyCompact(): { calls: string[]; failNext: { value: boolean }; compact: AutoMemoryCompact } {
    const calls: string[] = [];
    const failNext = { value: false };
    return {
      calls,
      failNext,
      compact: {
        async maybeRun(characterId) {
          calls.push(characterId);
          if (failNext.value) throw new Error("compactor exploded");
        },
      },
    };
  }

  it("runs the chain in order: episodic → flush → tidy → compact (row 10)", async () => {
    const f = fresh();
    const order: string[] = [];
    const episodic: EpisodicWriter = {
      async summarize() {
        order.push("episodic");
        return { entryIds: ["0001-episode"] };
      },
    };
    const flush: FlushWriter = {
      async run() {
        order.push("flush");
        return { writes: 0 };
      },
    };
    const tidy: AutoMemoryTidy = {
      async maybeRun() {
        order.push("tidy");
      },
    };
    const compact: AutoMemoryCompact = {
      async maybeRun() {
        order.push("compact");
      },
    };
    const { auto } = wire(f, { episodic, flush, logger: captureLogger().logger, tidy, compact });
    seed(f, 201); // crosses both the episodic and the flush thresholds

    await auto.onTurnCompleted("taki");

    // The compactor re-runs the flush over its retiring span, so it must see watermarks this pass finished with.
    expect(order).toEqual(["episodic", "flush", "tidy", "compact"]);
  });

  it("runs even on a turn where no write pass fired (its trigger decides for itself)", async () => {
    const f = fresh();
    const c = spyCompact();
    const { auto } = wire(f, {
      episodic: spyEpisodic().writer,
      flush: spyFlush().writer,
      logger: captureLogger().logger,
      compact: c.compact,
    });
    seed(f, 3);

    await auto.onTurnCompleted("taki");
    expect(c.calls).toEqual(["taki"]);
  });

  it("with NO compact dep the pass behaves exactly as before (byte-identical write path)", async () => {
    const f = fresh();
    const ep = spyEpisodic();
    const cap = captureLogger();
    const { autoState, auto } = wire(f, { episodic: ep.writer, flush: spyFlush().writer, logger: cap.logger });
    seed(f, 20);

    await auto.onTurnCompleted("taki");

    expect(ep.calls).toHaveLength(1);
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20);
    expect(cap.warns).toEqual([]);
  });

  it("a failing compactor warns (kind: compact) and never breaks the turn's write passes", async () => {
    const f = fresh();
    const c = spyCompact();
    c.failNext.value = true;
    const ep = spyEpisodic();
    const cap = captureLogger();
    const { autoState, auto } = wire(f, {
      episodic: ep.writer,
      flush: spyFlush().writer,
      logger: cap.logger,
      compact: c.compact,
    });
    seed(f, 20);

    await expect(auto.onTurnCompleted("taki")).resolves.toBeUndefined();
    expect(autoState.get("taki").lastEpisodicSeq).toBe(20);
    expect(cap.warns.some((w) => w.kind === "compact")).toBe(true);
  });
});
