/** Explicit owner-authorized import of five evidenced calls; no model dispatch or business-state writes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase } from '../../../../../../packages/core/src/db/sqlite.ts';
import { MIGRATIONS } from '../../../../../../packages/core/src/db/migrations/index-list.ts';
import { createAuxiliaryUsageRepo } from '../../../../../../packages/core/src/db/auxiliary-usage-repo.ts';
import { normalizeAuxiliaryUsage } from '../../../../../../packages/core/src/observability/auxiliary-usage-normalization.ts';

const path = process.argv[2];
const output = process.argv[3];
if (!path || !output) throw new Error('Use <database> <report.json>');
const events = readFileSync('target/cache-token-cost-real-20261101/20261101T110144Z/real/events.jsonl', 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
const completed = events.filter((event) => event.kind === 'model.completed');
if (completed.length !== 5) throw new Error('EVIDENCE_COUNT_CHANGED');
const id = (event) => {
  const hex = createHash('sha256').update(`taki-aux-import-v1:${event.responseId}:${event.promptDigest}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
const applied = [];
const db = openDatabase({ path: resolve(path), migrations: MIGRATIONS, onMigrated: (versions) => applied.push(...versions) });
try {
  const repo = createAuxiliaryUsageRepo(db);
  db.transaction(() => {
    for (const event of completed) {
      const starts = events.filter((entry) => entry.kind === 'model.started' && entry.mode === event.mode
        && entry.ordinal === event.ordinal && entry.promptDigest === event.promptDigest);
      if (starts.length !== 1) throw new Error('START_EVIDENCE_AMBIGUOUS');
      const callId = id(event);
      repo.start({ callId, taskId: null, source: 'utility', label: event.label, provider: event.provider,
        modelId: event.model, startedAt: starts[0].at });
      repo.settle({ callId, status: 'completed', finishedAt: event.at, responseId: event.responseId,
        usage: normalizeAuxiliaryUsage(event.sdkUsage) });
    }
  });
  const report = { database: resolve(path), applied,
    importedCallIds: completed.map(id), evidence: 'prior real/events.jsonl; original timestamps, null unknown task IDs',
    query: repo.query({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z', limit: 100 }),
    integrity: db.prepare('PRAGMA integrity_check').all(), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ applied, imported: report.importedCallIds.length, totalCalls: report.query.totalCalls,
    tokenCounts: report.query.tokenCounts, integrity: report.integrity, foreignKeys: report.foreignKeys }));
} finally { db.close(); }
