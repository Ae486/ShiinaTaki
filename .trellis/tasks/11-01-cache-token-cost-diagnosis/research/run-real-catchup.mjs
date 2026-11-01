/** Owner-authorized one-off: production ingestion/compaction, private backup manifest, sanitized per-call usage. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase } from '../../../../packages/core/src/db/sqlite.ts';
import { MIGRATIONS } from '../../../../packages/core/src/db/migrations/index-list.ts';
import { createTimelineRepo } from '../../../../packages/core/src/db/timeline-repo.ts';
import { createSummaryRepo } from '../../../../packages/core/src/db/summary-repo.ts';
import { createPrimaryConversationSourceRepo } from '../../../../packages/core/src/db/primary-conversation-source-repo.ts';
import { createCanonicalIngestionRepo } from '../../../../packages/core/src/db/canonical-ingestion-repo.ts';
import { createMemoryAutoRepo } from '../../../../packages/core/src/db/memory-auto-repo.ts';
import { createMemoryEventsRepo } from '../../../../packages/core/src/db/memory-events-repo.ts';
import { createCompactionOperationRepo } from '../../../../packages/core/src/db/compaction-operation-repo.ts';
import { createConfigRepo } from '../../../../packages/core/src/db/config-repo.ts';
import { createConfigSource } from '../../../../packages/core/src/config/config-source.ts';
import { loadContextConfig } from '../../../../packages/core/src/config/context-config.ts';
import { loadMemoryConfig } from '../../../../packages/core/src/config/memory-config.ts';
import { loadProviderConfig } from '../../../../packages/core/src/config/provider-config.ts';
import { loadUtilityConfig } from '../../../../packages/core/src/config/utility-config.ts';
import { createModels } from '../../../../packages/core/src/config/provider-factory.ts';
import { createCanonicalLocalRuntime } from '../../../../packages/core/src/memory/canonical-local-runtime.ts';
import { createCanonicalLocalIngestion } from '../../../../packages/core/src/memory/canonical-local-ingestion.ts';
import { createUtilitySlot } from '../../../../packages/core/src/memory/utility-slot.ts';
import { primaryEntryDigest } from '../../../../packages/core/src/memory/canonical-ingestion-source.ts';
import { MEMORY_VOICE_RULE } from '../../../../packages/core/src/memory/write-convention.ts';
import { createConversationStore } from '../../../../packages/core/src/agents/conversation-store.ts';
import { createCompactionPass } from '../../../../packages/core/src/agents/compaction-pass.ts';

const { values } = parseArgs({ options: { database: { type: 'string' }, output: { type: 'string' }, mode: { type: 'string' } } });
if (!values.database || !values.output || !['inspect','classify','ingest','compact','verify'].includes(values.mode)) {
  throw new Error('Usage: --database <db> --output <private-dir> --mode inspect|classify|ingest|compact|verify');
}
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const at = () => new Date().toISOString();
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const emit = (event) => {
  const item = { at: at(), mode: values.mode, ...event };
  appendFileSync(join(output, 'events.jsonl'), JSON.stringify(item) + '\n');
  console.log(JSON.stringify(item));
};
const log = { child: () => log, info: (data, message) => emit({ kind: 'info', data, message }),
  warn: (data, message) => emit({ kind: 'warn', data, message }), error: (data, message) => emit({ kind: 'error', data, message }) };
let utility;
const db = openDatabase({ path: values.database, migrations: MIGRATIONS,
  onMigrated: (versions) => emit({ kind: 'migrated', versions }) });
try {
  const source = createConfigSource({ env: process.env, repo: createConfigRepo(db) });
  const env = source.env();
  const context = loadContextConfig(env);
  const memoryConfig = loadMemoryConfig(env);
  const selection = db.prepare('SELECT mode,active_epoch_id FROM memory_authority_selection').get();
  if (selection.mode !== 'canonical-local') throw new Error('EXPECTED_CANONICAL_LOCAL');
  const epochId = selection.active_epoch_id;
  const characterId = 'taki';
  const timeline = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const primarySources = createPrimaryConversationSourceRepo({ db, timeline });
  const providerConfig = loadProviderConfig(env);
  const utilityConfig = loadUtilityConfig(env);
  const configuredModel = createModels({ provider: providerConfig, vision: null }).model;
  utility = createUtilitySlot({ mainModel: configuredModel, config: utilityConfig, logger: log });
  let label = null;
  let phaseFailed = false;
  let callOrdinal = 0;
  const observedModel = new Proxy(utility.model, { get(target, key) {
    if (key === 'doStream') return () => { throw new Error('UNEXPECTED_STREAM_IN_CATCHUP'); };
    if (key !== 'doGenerate') return Reflect.get(target, key, target);
    return async (request) => {
      if (phaseFailed) throw new Error('REAL_CATCHUP_PHASE_ALREADY_FAILED');
      const ordinal = ++callOrdinal;
      const started = Date.now();
      const promptDigest = hash(request.prompt);
      emit({ kind: 'model.started', ordinal, label, model: target.modelId, promptDigest });
      try {
        const timeout = AbortSignal.timeout(300_000);
        const response = await target.doGenerate({ ...request,
          abortSignal: request.abortSignal ? AbortSignal.any([request.abortSignal, timeout]) : timeout });
        let raw = response.response?.body;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
        const observation = { kind: 'model.completed', ordinal, label, elapsedMs: Date.now() - started,
          provider: target.provider, model: target.modelId, responseId: response.response?.id,
          promptDigest, finishReason: response.finishReason,
          sdkUsage: response.usage ?? null, rawUsage: raw?.usage ?? null,
          responseDigest: hash(response.content) };
        emit(observation);
        return response;
      } catch (error) {
        phaseFailed = true;
        emit({ kind: 'model.failed', ordinal, label, elapsedMs: Date.now() - started,
          errorName: error?.name, statusCode: typeof error?.statusCode === 'number' ? error.statusCode : null,
          usage: null, outcome: 'unknown_unless_provider_proves_rejection' });
        // A one-off catch-up must not turn SDK's default retry budget into duplicate paid dispatches.
        throw new Error('REAL_CATCHUP_PROVIDER_FAILED');
      }
    };
  } });
  const slot = { ...utility, model: observedModel, run: (nextLabel, task) => utility.run(nextLabel, async () => {
    label = nextLabel;
    try { return await task(); } finally { label = null; }
  }) };
  const engine = createCanonicalLocalRuntime({ db, epochId, config: memoryConfig });
  const journal = createCanonicalIngestionRepo({ db, maintenance: engine.maintenanceStore });
  const ingestion = createCanonicalLocalIngestion({ provider: engine.provider, authority: engine.authority,
    maintenance: engine.maintenanceStore, journal, timeline, primarySources, slot,
    autoState: createMemoryAutoRepo(db), events: createMemoryEventsRepo(db), config: memoryConfig });
  const window = db.prepare("SELECT * FROM slot_window_state WHERE slot='main'").get();
  const effective = Math.max(1, Math.floor(Math.min(window?.effective_window ?? context.contextTokens.main,
    context.contextTokens.main) / (window?.factor ?? 1)));
  const historyBudget = Math.floor(effective * context.historyRatio);
  const store = createConversationStore({ repo: timeline, summaries, window: { budget: () => historyBudget } });
  const scope = { epochId, characterId };
  const reportState = () => {
    const summary = summaries.getCheckpoint(characterId);
    const projection = store.project(characterId);
    return { migration: db.prepare('SELECT max(version) n FROM migrations').get().n,
      timeline: db.prepare('SELECT count(*) n,max(seq) tail FROM timeline_messages').get(),
      summary: summary ? { throughSeq: summary.throughSeq, revision: summary.revision, chars: summary.text.length,
        digest: hash(summary.text) } : null,
      cursor: journal.cursor(scope), pendingWitnesses: journal.unprocessedCount(scope),
      coverageGap: journal.coverageGap({ ...scope, throughSeq: timeline.latestSeq(characterId) }) ?? null,
      spans: db.prepare('SELECT state,count(*) n FROM canonical_memory_ingestion_spans GROUP BY state').all(),
      replay: { historyBudget, effectiveEstimatorWindow: effective, windowStartSeq: projection.windowStartSeq,
        ...projection.measurement, actualHistoryEstimate: store.estimatedTokens(characterId) } };
  };
  const before = reportState();
  emit({ kind: 'phase.started', mode: values.mode, database: resolve(values.database), before,
    route: { model: utilityConfig?.model ?? providerConfig.model,
      hostname: new URL(utilityConfig?.baseUrl ?? providerConfig.baseUrl).hostname } });
  if (values.mode === 'classify') {
    const approved = new Map([[3816,'55610f46-ce7c-4f8f-ab42-ae428f52a145'],
      [3838,'204557ca-8dcd-4f95-9923-3e80f3b8e2b9'],[3847,'7346765e-644a-4f3a-bc8d-de84b26cbf04']]);
    const audit = [];
    db.transaction(() => {
      for (const [seq,id] of approved) {
        const [entry] = timeline.rangeAscending(characterId, seq-1, seq);
        if (!entry || entry.id !== id || entry.role !== 'user' || entry.parts || entry.sourceContext) throw new Error('HISTORICAL_SOURCE_CHANGED');
        const prior = db.prepare('SELECT * FROM canonical_memory_primary_commits WHERE timeline_seq=:seq').get({ seq });
        if (db.prepare('SELECT 1 FROM hindsight_ingestion_primary_commits WHERE timeline_seq=:seq').get({ seq })) throw new Error('HISTORICAL_SOURCE_ALREADY_BOUND');
        ingestion.recordPrimaryCommitted({ characterId, entries: [entry] });
        audit.push({ seq, id, entryDigest: primaryEntryDigest(entry), prior: prior ?? null,
          classification: 'operator_accepted_historical_user_source', historicalRunLinkage: 'unknown',
          after: db.prepare('SELECT * FROM canonical_memory_primary_commits WHERE timeline_seq=:seq').get({ seq }) });
      }
    });
    writeFileSync(join(output, 'historical-classification.json'), JSON.stringify({ at: at(), epochId,
      authorization: 'Owner authorized real-data catch-up and paid model calls in the current task.', audit }, null, 2) + '\n');
    emit({ kind: 'classified', count: audit.length, seqs: audit.map((row) => row.seq) });
  }
  if (values.mode === 'ingest') {
    const result = await ingestion.run({ characterId, throughSeq: before.timeline.tail });
    emit({ kind: 'ingestion.result', result });
    if (journal.unprocessedCount(scope) !== 0 || result.coverageGap) throw new Error('CATCHUP_INGESTION_INCOMPLETE');
  }
  if (values.mode === 'compact') {
    const operations = createCompactionOperationRepo(db);
    const compaction = createCompactionPass({ timeline, summaries, operations, slot, logger: log,
      view: { estimatedTokens: store.estimatedTokens, budget: () => historyBudget },
      config: { ...context.compact, summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 },
      protectedContent: () => [MEMORY_VOICE_RULE] });
    await compaction.maybeRun(characterId);
    const afterSummary = summaries.getCheckpoint(characterId);
    emit({ kind: 'compaction.result', operation: afterSummary?.lastOperationId ? operations.get(afterSummary.lastOperationId) : null });
    if (!afterSummary || afterSummary.revision <= (before.summary?.revision ?? 0)) throw new Error('CATCHUP_SUMMARY_NOT_ADVANCED');
  }
  if (values.mode === 'verify') {
    const manifest = JSON.parse(readFileSync(join(output, '..', 'backup-manifest.json'), 'utf8'));
    const records = engine.maintenanceStore.list({ epochId, characterId });
    const recent = records.filter((record) => Date.parse(record.unit.createdAt) >= Date.parse(manifest.created_at));
    const observations = [];
    for (const record of recent) {
      const result = await engine.provider.recall({ requestId: `catchup-verify:${record.unit.memoryId}`,
        authorityEpochId: epochId, actor: 'operator' }, { bankId: record.unit.bankId, query: record.unit.text,
        queryTimestamp: null, budget: 'mid', limit: 20, maxTokens: 8000,
        factTypes: ['world','experience','observation'], layerIds: [], includeInvalidated: false });
      observations.push({ memoryId: record.unit.memoryId, bankId: record.unit.bankId, layer: record.policy.layerId,
        visibility: record.policy.visibility, state: record.unit.state,
        found: result.ok && result.data.hits.some((hit) => hit.record.unit.memoryId === record.unit.memoryId),
        errorCode: result.ok ? null : result.error.code });
    }
    writeFileSync(join(output, 'recall-verification.json'), JSON.stringify({ at: at(), observations,
      modelCalls: 0, scope: 'Exact-content Local recall/index and eligibility check, not a natural-query quality benchmark.' }, null, 2) + '\n');
    emit({ kind: 'recall.verified', records: observations });
  }
  const after = reportState();
  const result = { at: at(), mode: values.mode, before, after, modelCalls: callOrdinal,
    tokenMeasurement: 'Provider usage is actual; replay/pressure values are project estimator units, history-only.' };
  writeFileSync(join(output, `${values.mode}-result.json`), JSON.stringify(result, null, 2) + '\n');
  emit({ kind: 'phase.completed', ...result });
} catch (error) {
  emit({ kind: 'phase.failed', mode: values.mode, code: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'REAL_CATCHUP_FAILED',
    errorName: error?.name });
  process.exitCode = 1;
} finally { await utility?.stop(); db.close(); }
