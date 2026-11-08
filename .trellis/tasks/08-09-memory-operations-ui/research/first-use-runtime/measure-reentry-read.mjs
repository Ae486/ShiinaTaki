// Diagnostic only: profile existing synchronous readers on a completed SQLite backup.
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { openReadonlyDatabase } from '../../../../../packages/core/src/db/sqlite.ts';
import { readMemoryAuthoritySelection } from '../../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts';
import { readVerifiedTransitionPublication } from '../../../../../packages/core/src/db/memory-transition-publication-reader.ts';
import { readVerifiedTransitionCandidate } from '../../../../../packages/core/src/memory/transitions/transition-final-mapping.ts';
import { assertTransitionConfiguration } from '../../../../../packages/core/src/memory/transitions/transition-current-identity.ts';
import { readTransitionTemplateState } from '../../../../../packages/core/src/memory/transitions/transition-template-state.ts';

const [snapshot, output] = process.argv.slice(2);
if (!snapshot || !output) throw new Error('usage: measure-reentry-read.mjs <sealed-snapshot> <output-prefix>');
const db = openReadonlyDatabase(snapshot);
const session = new Session(); session.connect();
const post = (method) => new Promise((resolve, reject) => session.post(method, (error, result) => error ? reject(error) : resolve(result)));
const results = [];
try {
  const marker = db.prepare('SELECT transition_receipt_id FROM memory_authority_selection WHERE singleton=1').get();
  const publication = db.prepare('SELECT candidate_id FROM memory_transition_publications WHERE receipt_id=:id')
    .get({ id: marker.transition_receipt_id });
  await post('Profiler.enable');
  const intent = JSON.parse(db.prepare('SELECT intent_json FROM memory_transition_intents ORDER BY rowid DESC LIMIT 1').get().intent_json);
  const reads = process.argv.includes('--guard') ? Array.from({ length: 3 }, (_, index) => [
    `guard-${index}`, () => assertTransitionConfiguration(db, intent.request.expected, intent.request.expected.configFingerprint),
  ]) : [
    ['candidate', () => readVerifiedTransitionCandidate(db, String(publication.candidate_id))],
    ['publication', () => readVerifiedTransitionPublication(db, String(marker.transition_receipt_id))],
    ['selection', () => readMemoryAuthoritySelection(db)],
  ];
  for (const [label, read] of reads) {
    await post('Profiler.start'); const started = performance.now();
    let error = null;
    try { read(); } catch (failure) { error = failure instanceof Error ? failure.message : 'unknown'; }
    const ms = performance.now() - started;
    const { profile } = await post('Profiler.stop');
    writeFileSync(`${output}-${label}.cpuprofile`, JSON.stringify(profile));
    const result = { label, ms, error }; results.push(result); console.log(JSON.stringify(result));
  }
  if (process.argv.includes('--guard')) {
    writeFileSync(`${output}-components.json`, JSON.stringify(readTransitionTemplateState(db, intent.request.expected)));
  }
} finally {
  session.disconnect(); db.close();
  writeFileSync(`${output}.json`, JSON.stringify({ snapshot, results }, null, 2));
}
if (results.some(result => result.error)) process.exitCode = 1;
