/** Synthetic same-process index comparison; no authoritative user data or model calls. */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createCanonicalMaintenanceFixture } from "../../../../packages/core/src/db/canonical-memory-maintenance-fixtures.ts";
import { createCanonicalMemorySparseRepo } from "../../../../packages/core/src/db/canonical-memory-sparse-repo.ts";
import { createIntlSegmenterTokenizer } from "../../../../packages/core/src/memory/search-tokenizer.ts";
import { canonicalSearchProjection } from "../../../../packages/core/src/memory/canonical-search-projection.ts";
import { rebuildSearchProjection } from "../../../../packages/core/src/memory/search-projection-rebuild.ts";

const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
try {
  const f = createCanonicalMaintenanceFixture(db);
  db.transaction(() => {
    for (let index = 0; index < 10000; index++) f.seed({ memoryId: `synthetic-${index}`,
      unit: { text: `我 喜欢 拉面 和 咖啡，这是索引重建响应性验证的合成记录 ${index}` } });
  });
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: false });
  const samples = [];
  let previous = performance.now();
  const timer = setInterval(() => { const now = performance.now(); samples.push(now - previous); previous = now; }, 1);
  const started = performance.now();
  createCanonicalMemorySparseRepo(db).rebuild(f.epochId, tokenizer);
  const synchronousMs = performance.now() - started;
  await new Promise(resolve => setTimeout(resolve, 5));
  const synchronousMaxPauseMs = Math.max(...samples);
  samples.length = 0;
  await setImmediate(); previous = performance.now();
  const candidateStarted = performance.now();
  const result = await rebuildSearchProjection({ db, source: canonicalSearchProjection(db, f.epochId), tokenizer,
    assertCurrent() {}, publish() {} });
  const asynchronousMs = performance.now() - candidateStarted;
  clearInterval(timer);
  samples.sort((a, b) => a - b);
  const evidence = { node: process.version, rows: result.indexed, synchronousMs, synchronousMaxPauseMs,
    asynchronousMs, timerSamples: samples.length, asynchronousMaxPauseMs: samples.at(-1),
    asynchronousP95PauseMs: samples[Math.floor(samples.length * .95)],
    limits: "One synthetic in-memory SQLite run; timer responsiveness, not native UI, disk durability speed, or a universal budget." };
  writeFileSync("G:/taki-native-flow-artifacts-20261110/search-rebuild-benchmark.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { db.close(); }
