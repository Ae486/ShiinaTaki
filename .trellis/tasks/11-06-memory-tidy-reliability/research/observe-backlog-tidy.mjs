/** One authorized real-model observation on an isolated copy; no live database writes. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { createConfigSource } from "../../../../packages/core/src/config/config-source.ts";
import { loadProviderConfig } from "../../../../packages/core/src/config/provider-config.ts";
import { loadUtilityConfig } from "../../../../packages/core/src/config/utility-config.ts";
import { loadMemoryConfig } from "../../../../packages/core/src/config/memory-config.ts";
import { loadContextConfig } from "../../../../packages/core/src/config/context-config.ts";
import { createCanonicalLocalRuntime } from "../../../../packages/core/src/memory/canonical-local-runtime.ts";
import { createMemoryAutoRepo } from "../../../../packages/core/src/db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../../../../packages/core/src/db/memory-events-repo.ts";
import { createMemoryTidyReviewRepo } from "../../../../packages/core/src/db/memory-tidy-review-repo.ts";
import { createUtilitySlot } from "../../../../packages/core/src/memory/utility-slot.ts";
import { createTidyPass } from "../../../../packages/core/src/memory/tidy-pass.ts";
import { canonicalTidyReport } from "../../../../packages/core/src/memory/tidy-coverage.ts";

assert(process.argv.includes("--paid-once"));
const root = resolve("target/memory-tidy-backlog-observation-20261106");
assert.equal(JSON.parse(readFileSync(join(root, "snapshot.json"), "utf8")).readOnlySource, true);
const db = openDatabase({ path: join(root, "isolated.db"), migrations: MIGRATIONS });
const warnings = [];
const calls = [];
const progress = [];
const report = { startedAt: new Date().toISOString(), calls, progress, warnings };
const save = () => writeFileSync(join(root, "observation.json"), JSON.stringify(report, null, 2));
const logger = { child: () => logger, info() {}, warn: (data) => warnings.push(data), error() {} };
let slot;
let pass;
let timer;
try {
  const env = createConfigSource({ env: { ...parseEnv(readFileSync(".env.local", "utf8")), ...process.env }, repo: createConfigRepo(db) }).env();
  const utility = loadUtilityConfig(env);
  const provider = utility ?? loadProviderConfig(env);
  const config = loadMemoryConfig(env);
  const windows = loadContextConfig(env).contextTokens;
  config.tidyInputTokens = Math.min(config.tidyInputTokens, Math.floor((utility ? windows.utility : windows.main) / 2));
  Object.assign(report, { model: provider.model, route: utility ? "utility" : "main-fallback",
    config: { candidates: config.reportClassCap, inputTokens: config.tidyInputTokens,
      timeoutMs: config.tidyBatchTimeoutMs, maxSteps: config.tidyMaxSteps } });
  const require = createRequire(resolve("packages/core/package.json"));
  const { createOpenAICompatible } = await import(pathToFileURL(require.resolve("@ai-sdk/openai-compatible")).href);
  const model = createOpenAICompatible({ name: "backlog-observation", baseURL: provider.baseUrl, apiKey: provider.apiKey }).languageModel(provider.model);
  const generate = model.doGenerate.bind(model);
  model.doGenerate = async (options) => {
    const call = { index: calls.length + 1, startedAt: new Date().toISOString() };
    calls.push(call);
    save();
    try {
      const result = await generate(options);
      Object.assign(call, { finishedAt: new Date().toISOString(), status: "completed", usage: result.usage,
        tools: result.content.filter((part) => part.type === "tool-call").map((part) => part.toolName) });
      return result;
    } catch (error) {
      Object.assign(call, { finishedAt: new Date().toISOString(), status: "failed", errorName: error instanceof Error ? error.name : "unknown" });
      throw error;
    } finally { save(); }
  };
  const selection = db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  assert.equal(selection.mode, "canonical-local");
  const engine = createCanonicalLocalRuntime({ db, epochId: selection.active_epoch_id, promptDir: resolve("prompt") });
  engine.banks("taki");
  const checkpoints = createMemoryTidyReviewRepo(db, selection.active_epoch_id);
  const autoState = createMemoryAutoRepo(db);
  report.initialPending = canonicalTidyReport({ view: engine.tidy, characterId: "taki", config,
    coverage: checkpoints.read("taki"), lastTidyAt: autoState.get("taki").lastTidyAt }).remaining;
  slot = createUtilitySlot({ mainModel: model, logger });
  pass = createTidyPass({ view: engine.tidy, slot, logger, checkpoints, autoState, events: createMemoryEventsRepo(db), config });
  // The observation itself is capped separately from production's per-batch limits.
  timer = setTimeout(() => { report.observationDeadlineReached = true; void pass.stop(); }, 20 * 60_000);
  let lastReviewed = -1;
  report.outcome = await pass.runNow("taki", { onProgress: (value) => {
    progress.push({ at: new Date().toISOString(), ...value });
    if (value.reviewed !== lastReviewed) {
      lastReviewed = value.reviewed;
      console.log(JSON.stringify({ ...value, at: new Date().toISOString() }));
    }
    save();
  } });
  report.quickCheck = db.prepare("PRAGMA quick_check").get();
  console.log(JSON.stringify({ outcome: report.outcome, calls: calls.length, quickCheck: report.quickCheck }));
} catch (error) {
  report.failure = error instanceof Error ? error.name : "unknown";
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await pass?.stop();
  await slot?.stop();
  report.finishedAt = new Date().toISOString();
  save();
  db.close();
}
