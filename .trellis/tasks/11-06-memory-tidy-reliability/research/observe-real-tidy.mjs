/** Explicit paid observation on a caller-supplied isolated database copy; never opens the live database. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { createConfigSource } from "../../../../packages/core/src/config/config-source.ts";
import { loadProviderConfig } from "../../../../packages/core/src/config/provider-config.ts";
import { loadUtilityConfig } from "../../../../packages/core/src/config/utility-config.ts";
import { loadMemoryConfig } from "../../../../packages/core/src/config/memory-config.ts";
import { createCanonicalLocalRuntime } from "../../../../packages/core/src/memory/canonical-local-runtime.ts";
import { createMemoryAutoRepo } from "../../../../packages/core/src/db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../../../../packages/core/src/db/memory-events-repo.ts";
import { createMemoryTidyReviewRepo } from "../../../../packages/core/src/db/memory-tidy-review-repo.ts";
import { createUtilitySlot } from "../../../../packages/core/src/memory/utility-slot.ts";
import { createTidyPass } from "../../../../packages/core/src/memory/tidy-pass.ts";

const database = resolve(process.argv[2] ?? "");
const approvedRoot = resolve("target", "memory-tidy-real-observation-20261106");
assert.equal(process.argv.includes("--paid-once"), true, "Use --paid-once only with owner authorization.");
assert.equal(database, join(approvedRoot, "isolated.db"), "This observer only accepts its dedicated isolated copy.");
const marker = JSON.parse(readFileSync(join(approvedRoot, "snapshot.json"), "utf8"));
assert.equal(marker.readOnlySource, true);
const db = openDatabase({ path: database, migrations: MIGRATIONS });
const calls = [];
const warnings = [];
const logger = { child: () => logger, info() {}, warn: (data) => warnings.push(data), error() {} };
let slot;
try {
  const env = createConfigSource({ env: { ...parseEnv(readFileSync(".env.local", "utf8")), ...process.env }, repo: createConfigRepo(db) }).env();
  const utility = loadUtilityConfig(env);
  const config = utility ?? loadProviderConfig(env);
  const require = createRequire(resolve("packages/core/package.json"));
  const { createOpenAICompatible } = await import(pathToFileURL(require.resolve("@ai-sdk/openai-compatible")).href);
  const model = createOpenAICompatible({ name: utility ? "taki-utility" : "taki", baseURL: config.baseUrl, apiKey: config.apiKey }).languageModel(config.model);
  const generate = model.doGenerate.bind(model);
  model.doGenerate = async (options) => {
    const entry = { index: calls.length + 1, startedAt: new Date().toISOString() };
    calls.push(entry);
    try {
      const result = await generate(options);
      Object.assign(entry, { finishedAt: new Date().toISOString(), status: "completed", usage: result.usage,
        toolNames: result.content.filter((part) => part.type === "tool-call").map((part) => part.toolName), finishReason: result.finishReason.unified });
      return result;
    } catch (error) {
      Object.assign(entry, { finishedAt: new Date().toISOString(), status: "failed", errorName: error instanceof Error ? error.name : "unknown" });
      throw error;
    }
  };
  const selection = db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  assert.equal(selection.mode, "canonical-local");
  const engine = createCanonicalLocalRuntime({ db, epochId: selection.active_epoch_id, promptDir: resolve("prompt") });
  engine.banks("taki");
  slot = createUtilitySlot({ mainModel: model, logger });
  const checkpoints = createMemoryTidyReviewRepo(db, selection.active_epoch_id);
  const pass = createTidyPass({ view: engine.tidy, slot, logger, checkpoints,
    autoState: createMemoryAutoRepo(db), events: createMemoryEventsRepo(db), timeoutMs: 120_000,
    config: { ...loadMemoryConfig(env), tidyMaxSteps: 12 } });
  const progress = [];
  const startedAt = new Date().toISOString();
  const outcome = await pass.runNow("taki", { onProgress: (value) => { progress.push({ ...value }); } });
  const report = { startedAt, finishedAt: new Date().toISOString(), model: config.model, route: utility ? "utility" : "main-fallback",
    outcome, calls, progress, warnings, quickCheck: db.prepare("PRAGMA quick_check").get(),
    coveredMemories: checkpoints.read("taki").memories.length };
  writeFileSync(join(dirname(database), "observation.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ model: report.model, route: report.route, outcome, actualCalls: calls.length,
    artifacts: dirname(database), quickCheck: report.quickCheck }));
} catch (error) {
  writeFileSync(join(dirname(database), "observation-failure.json"), JSON.stringify({ calls, errorName: error instanceof Error ? error.name : "unknown" }, null, 2));
  console.error(JSON.stringify({ failed: true, errorName: error instanceof Error ? error.name : "unknown", actualCalls: calls.length }));
  process.exitCode = 1;
} finally { await slot?.stop(); db.close(); }
