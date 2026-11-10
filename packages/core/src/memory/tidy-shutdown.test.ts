import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";

interface Opened {
  db: Database;
  dataDir: string;
  release(): void;
  runtime?: ReturnType<typeof composeMemoryRuntime>;
}
const opened: Opened[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    item.release();
    await item.runtime?.stop();
    item.db.close();
    rmTempDir(item.dataDir);
  }
});

function heldModel() {
  const model = scriptedGenerateModel([{ kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits", input: {} }]);
  let entered!: () => void;
  let release!: () => void;
  let signal: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const generate = model.doGenerate.bind(model);
  model.doGenerate = async (options) => {
    signal = options.abortSignal;
    entered();
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      void held.then(() => { signal?.removeEventListener("abort", abort); resolve(); });
    });
    return generate(options);
  };
  return { model, started, release, signal: () => signal };
}

async function boot(canonical: boolean) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const dataDir = mkdtempSync(join(tmpdir(), "taki-tidy-shutdown-"));
  const held = heldModel();
  const item: Opened = { db, dataDir, release: held.release };
  opened.push(item);
  const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(new Date().toISOString());
  if (canonical) {
    db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local', active_epoch_id=:epoch,
      verified_snapshot_id='fixture-snapshot', activation_transaction_id='fixture-activation' WHERE singleton=1`)
      .run({ epoch: epoch.epochId });
  }
  const { logger } = createCaptureLogger();
  const runtime = composeMemoryRuntime({ db, dataDir, promptDir: join(dataDir, "prompt"), model: held.model,
    timeline: createTimelineRepo(db), summaries: createSummaryRepo(db), windowStart: () => 1,
    estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger });
  item.runtime = runtime;
  await runtime.captureRun("taki");
  runtime.memory.writeEntry({ characterId: "taki", type: "episodes", content: "Synthetic shutdown observation",
    importance: 4, disclosure: "synthetic trigger", origin: "observed" });
  return { runtime, held };
}

describe("composed tidy shutdown", () => {
  it.each([false, true])("aborts the active default-budget batch through runtime.stop (canonical=%s)", async (canonical) => {
    const { runtime, held } = await boot(canonical);
    const pending = runtime.tidy.runNow("taki");
    await held.started;
    expect(held.signal()?.aborted).toBe(false);

    const stopped = runtime.stop();
    expect(held.signal()?.aborted).toBe(true);
    expect(await pending).toMatchObject({ status: "failed", reason: "unfinished", edits: 0, steps: 0 });
    await stopped;
    expect(runtime.utility.usage().calls).toBe(1);
  });
});
