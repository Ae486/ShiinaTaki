/** Offline projection only: current pure production replay code, read-only historical rows, no LLM calls. */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { createTimelineRepo } from '../../../../packages/core/src/db/timeline-repo.ts';
import { createConversationStore } from '../../../../packages/core/src/agents/conversation-store.ts';

const [databasePath, outputPath] = process.argv.slice(2);
if (!databasePath || !outputPath) throw new Error('Usage: node probe_replay.mjs <db> <output.json>');
const db = new DatabaseSync(databasePath, { readOnly: true });
db.exec('PRAGMA query_only=ON');
db.exec('PRAGMA busy_timeout=10000');
db.exec('BEGIN');
const state = db.prepare("SELECT * FROM slot_window_state WHERE slot='main'").get();
const summary = db.prepare('SELECT * FROM conversation_summary').get();
const effectiveEstimatorWindow = Math.max(1, Math.floor(state.effective_window / state.factor));
const historyBudget = Math.floor(effectiveEstimatorWindow * 0.7);
const baseRepo = createTimelineRepo(db);
const sourcePoints = db.prepare("SELECT seq FROM timeline_messages WHERE character_id=? AND role='user' AND seq>? ORDER BY seq DESC LIMIT 12")
  .all(summary.character_id, summary.through_seq).reverse();
let previous;
const points = [];
for (const { seq } of sourcePoints) {
  const repo = { ...baseRepo, pageBefore: (input) => baseRepo.pageBefore({ ...input, before: Math.min(seq + 1, input.before ?? seq + 1) }) };
  const store = createConversationStore({ repo, window: { budget: () => historyBudget },
    summaries: { get: () => ({ throughSeq: summary.through_seq, text: summary.text }) } });
  const projection = store.project(summary.character_id);
  const serialized = projection.messages.map((message) => JSON.stringify(message));
  let equalLeadingMessages = 0;
  while (previous && equalLeadingMessages < Math.min(previous.serialized.length, serialized.length)
    && previous.serialized[equalLeadingMessages] === serialized[equalLeadingMessages]) equalLeadingMessages++;
  points.push({ userSeq: seq, windowStartSeq: projection.windowStartSeq, ...projection.measurement,
    comparedWithUserSeq: previous?.seq ?? null,
    equalLeadingReplayMessages: previous ? equalLeadingMessages : null,
    windowStartChanged: previous ? projection.windowStartSeq !== previous.windowStartSeq : null });
  previous = { seq, serialized, windowStartSeq: projection.windowStartSeq };
}
db.close();
const report = {
  scope: 'Offline current-code replay projection; does not reconstruct exact historical provider requests.',
  databasePath, latestPersistedCalibration: state, effectiveEstimatorWindow, assumedHistoryRatio: 0.7, historyBudget,
  summary: { revision: summary.revision, throughSeq: summary.through_seq, chars: summary.text.length },
  limitations: ['Fixed latest calibration across all 12 source points; historical per-request calibration is unavailable.',
    'No system instructions, tool schemas, volatile tail, or request-preparation reductions are included.',
    'All token numbers in this probe are project estimator units, not billed or provider tokenizer counts.',
    'The real repository parser enforces the current names-only tool-call privacy projection.'],
  points,
};
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report));
