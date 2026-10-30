import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMemoryConfig, type MemoryConfig } from "../config/memory-config.ts";
import { createMemoryAutoRepo, type MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo, type MemoryEventsRepo } from "../db/memory-events-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createCaptureLogger, type CapturedLog } from "../testing/capture-logger.ts";
import { failingGenerateModel, scriptedGenerateModel, type ScriptStep } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createBlockStore } from "./block-store.ts";
import { createMemoryEngine, type MemoryEngine } from "./memory-engine.ts";
import { createTidyPass, TIDY_SYSTEM_PROMPT, type TidyPass } from "./tidy-pass.ts";
import { createUtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";

const FINISH_STEP: ScriptStep = { kind: "tool", toolCallId: "f1", toolName: "memory_finish_edits", input: {} };

type MockModel = ReturnType<typeof scriptedGenerateModel>;

interface PassFixture {
  engine: MemoryEngine;
  autoState: MemoryAutoRepo;
  events: MemoryEventsRepo;
  /** Build a pass over THIS store state — scripts can then reference ids created by the test. */
  makePass(opts: { script?: ScriptStep[]; model?: MockModel; config?: Partial<MemoryConfig> }): {
    pass: TidyPass;
    model: MockModel;
    records: CapturedLog[];
    listActive: ReturnType<typeof vi.fn>;
  };
  seed(content: string): { id: string };
}

const opened: Array<{ db: Database; root: string }> = [];
afterEach(() => {
  for (const { db, root } of opened.splice(0)) {
    db.close();
    rmTempDir(root);
  }
});

function fresh(): PassFixture {
  const root = mkdtempSync(join(tmpdir(), "taki-pass-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push({ db, root });
  const engine = createMemoryEngine({
    db,
    memoryRoot: join(root, "memory"),
    blocks: createBlockStore({ root: join(root, "blocks") }),
  });
  const autoState = createMemoryAutoRepo(db);
  const events = createMemoryEventsRepo(db);

  return {
    engine,
    autoState,
    events,
    makePass({ script, model, config }) {
      const resolved = model ?? scriptedGenerateModel(script ?? [FINISH_STEP]);
      const { logger, records } = createCaptureLogger();
      const slot = createUtilitySlot({ mainModel: resolved, logger });
      const listActive = vi.fn(engine.tidy.listActive);
      const pass = createTidyPass({
        view: { ...engine.tidy, listActive },
        autoState,
        events,
        slot,
        config: { ...loadMemoryConfig({}), tidyWriteThreshold: 2, tidyMaxSteps: 6, ...config },
        logger,
      });
      return { pass, model: resolved, records, listActive };
    },
    seed: (content) =>
      engine.writeEntry({ characterId: "taki", type: "episodes", content, importance: 4, disclosure: "触发词" }),
  };
}

describe("tidy pass (batch 4b — triggers, zero-cost clean exit, structural termination, watermark)", () => {
  it("write-count trigger: below threshold not even the report runs; at threshold the pass fires", async () => {
    const f = fresh();
    const { pass, model, listActive } = f.makePass({}); // threshold 2
    f.seed("第一条记忆");

    await pass.maybeRun("taki");
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(listActive).not.toHaveBeenCalled();
    expect(f.autoState.get("taki").lastTidyAt).toBeNull();

    f.seed("第二条记忆");
    await pass.maybeRun("taki");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(f.autoState.get("taki").lastTidyAt).not.toBeNull();
    expect(f.events.listByCharacter({ characterId: "taki", limit: 10 }).map((e) => e.kind)).toEqual(["tidy"]);
  });

  it("runNow runs below the threshold, and a later clean invocation costs ZERO further model calls", async () => {
    const f = fresh();
    const { pass, model } = f.makePass({});
    f.seed("唯一的新记忆"); // 1 < threshold 2

    const first = await pass.runNow("taki");
    expect(first.status).toBe("ran");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(first.usage.calls).toBe(1);

    // Nothing new since the watermark and no defects: the report decides — no agent is even constructed.
    const second = await pass.runNow("taki");
    expect(second).toMatchObject({ status: "clean", edits: 0, steps: 0 });
    expect(second.defects).toEqual({ missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("an empty store is clean from the start — zero model calls, no watermark, no event", async () => {
    const f = fresh();
    const { pass, model } = f.makePass({});

    const outcome = await pass.runNow("taki");

    expect(outcome.status).toBe("clean");
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(f.autoState.get("taki").lastTidyAt).toBeNull();
    expect(f.events.listByCharacter({ characterId: "taki", limit: 10 })).toEqual([]);
  });

  it("the finish tool ends the loop early; failed ops and finish itself are not edits", async () => {
    const f = fresh();
    const { id } = f.seed("他叫P");
    const { pass, model } = f.makePass({
      script: [
        { kind: "tool", toolCallId: "c1", toolName: "memory_reinforce", input: { id: "9999-nope" } }, // -> ok:false
        { kind: "tool", toolCallId: "c2", toolName: "memory_set_disclosure", input: { id, disclosure: "问起名字" } },
        FINISH_STEP,
        { kind: "tool", toolCallId: "c4", toolName: "memory_reinforce", input: { id } }, // must never run
      ],
    });

    const outcome = await pass.runNow("taki");

    expect(model.doGenerateCalls).toHaveLength(3); // stopped by hasToolCall(memory_finish_edits)
    expect(outcome).toMatchObject({ status: "ran", steps: 3, edits: 1 });
  });

  it("a runaway pass that never calls finish is stopped by the step cap", async () => {
    const f = fresh();
    const { id } = f.seed("会被反复 reinforce 的记忆");
    const { pass, model } = f.makePass({
      script: Array.from({ length: 5 }, (_, i) => ({
        kind: "tool" as const,
        toolCallId: `r${i}`,
        toolName: "memory_reinforce",
        input: { id },
      })),
      config: { tidyMaxSteps: 3 },
    });

    const outcome = await pass.runNow("taki");

    expect(model.doGenerateCalls).toHaveLength(3);
    expect(outcome).toMatchObject({ status: "ran", steps: 3 });
    expect(f.autoState.get("taki").lastTidyAt).not.toBeNull(); // a capped pass still completed
  });

  it("records ONE tidy event carrying the edit count, with no turn to point at", async () => {
    const f = fresh();
    const { id } = f.seed("被整理的记忆");
    const { pass } = f.makePass({
      script: [
        { kind: "tool", toolCallId: "e1", toolName: "memory_set_disclosure", input: { id, disclosure: "问起这件事" } },
        FINISH_STEP,
      ],
    });

    const outcome = await pass.runNow("taki");

    expect(outcome).toMatchObject({ status: "ran", edits: 1, steps: 2 });
    const [event] = f.events.listByCharacter({ characterId: "taki", limit: 10 });
    expect(event).toMatchObject({ kind: "tidy", count: 1, turnSeq: null, entryId: null });
  });

  it("a failed model call leaves the watermark and the event log untouched (retries next trigger)", async () => {
    const f = fresh();
    f.seed("有工作可做");
    const { pass, records } = f.makePass({ model: failingGenerateModel(new Error("provider down")) as MockModel });

    const outcome = await pass.runNow("taki");

    expect(outcome.status).toBe("failed");
    expect(f.autoState.get("taki").lastTidyAt).toBeNull();
    expect(f.events.listByCharacter({ characterId: "taki", limit: 10 })).toEqual([]);
    expect(records.some((r) => r.level === "warn" && r.msg === "tidy pass failed; watermark not advanced")).toBe(true);
  });

  it("frames the input as a system-reminder user message and carries the report to the model", async () => {
    const f = fresh();
    f.seed("报告里必须出现的内容");
    const { pass, model } = f.makePass({});

    await pass.runNow("taki");

    const wire = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? []);
    expect(wire).toContain("<system-reminder>");
    expect(wire).toContain("NOT the primary agent");
    expect(wire).toContain("报告里必须出现的内容");
    expect(wire).toContain("organizing and maintaining your own long-term memory");
  });

  it("pins the prompt: six refinement principles, the do-nothing permission, and the R10 voice rule IMPORTED", () => {
    for (const principle of [
      "Integrate:",
      "Update:",
      "Organize:",
      "Infer sensibly:",
      "Be precise:",
      "Be comprehensive and concise:",
    ]) {
      expect(TIDY_SYSTEM_PROMPT).toContain(principle);
    }
    expect(TIDY_SYSTEM_PROMPT).toContain("call memory_finish_edits immediately");
    // Whole-constant containment: the voice rule is the write-convention export, not a paraphrase.
    expect(TIDY_SYSTEM_PROMPT).toContain(MEMORY_VOICE_RULE);
    expect(TIDY_SYSTEM_PROMPT).toContain("block_rethink only for sweeping changes");
    expect(TIDY_SYSTEM_PROMPT).toContain("memory-index");
    expect(TIDY_SYSTEM_PROMPT).toContain("user-model");
  });

  it("keeps memory content out of logs, events and the WS-facing outcome (counts only)", async () => {
    const secret = "这是绝对不能离开报告的内容XYZ";
    const f = fresh();
    f.seed(secret);
    const { pass, records } = f.makePass({});

    const outcome = await pass.runNow("taki");

    expect(JSON.stringify(records)).not.toContain(secret);
    expect(JSON.stringify(f.events.listByCharacter({ characterId: "taki", limit: 10 }))).not.toContain(secret);
    expect(JSON.stringify(outcome)).not.toContain(secret);
    expect(records.some((r) => r.level === "info" && r.msg === "tidy pass completed")).toBe(true);
  });
});
