/** Owner-authorized fixed-input experiment; all generated content stays in private artifacts. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { openDatabase } from '../../../../../../packages/core/src/db/sqlite.ts';
import { MIGRATIONS } from '../../../../../../packages/core/src/db/migrations/index-list.ts';
import { createAuxiliaryUsageRepo } from '../../../../../../packages/core/src/db/auxiliary-usage-repo.ts';
import { createAuxiliaryUsageMeter } from '../../../../../../packages/core/src/observability/auxiliary-usage-meter.ts';
import { createConfigSource } from '../../../../../../packages/core/src/config/config-source.ts';
import { createConfigRepo } from '../../../../../../packages/core/src/db/config-repo.ts';
import { loadProviderConfig } from '../../../../../../packages/core/src/config/provider-config.ts';
import { loadUtilityConfig } from '../../../../../../packages/core/src/config/utility-config.ts';
import { createUtilitySlot } from '../../../../../../packages/core/src/memory/utility-slot.ts';
import { createCanonicalIngestionModel } from '../../../../../../packages/core/src/memory/canonical-ingestion-model.ts';
import { parseCanonicalIngestionState } from '../../../../../../packages/core/src/db/canonical-ingestion-repo.ts';
import { createTimelineRepo } from '../../../../../../packages/core/src/db/timeline-repo.ts';
import { createSummaryRepo } from '../../../../../../packages/core/src/db/summary-repo.ts';
import { buildCompactionPrompt } from '../../../../../../packages/core/src/agents/compaction-pass.ts';
import { renderSafeTranscript, sanitizeCompactionText } from '../../../../../../packages/core/src/agents/context-reduction.ts';

const require = createRequire(new URL('../../../../../../packages/core/package.json', import.meta.url));
const { generateText } = await import(pathToFileURL(require.resolve('ai')).href);
const { createOpenAICompatible } = await import(pathToFileURL(require.resolve('@ai-sdk/openai-compatible')).href);
const mode = process.argv[2];
if (!['prepare', 'run', 'summary-control'].includes(mode)) throw new Error('Use prepare, run or summary-control');
const control = mode === 'summary-control';
const root = resolve('target/auxiliary-usage-20261101');
const prior = resolve('target/cache-token-cost-real-20261101/20261101T110144Z');
const output = join(root, 'reasoning');
mkdirSync(output, { recursive: true });
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save = (name, data) => writeFileSync(join(output, name), JSON.stringify(data, null, 2) + '\n');
const log = { child: () => log, info: () => {}, warn: (data) => console.log(JSON.stringify(data)) };
const source = new DatabaseSync(join(root, 'before-065.db'), { readOnly: true });
const pristine = new DatabaseSync(join(prior, 'pristine.db'), { readOnly: true });
const baseline = readFileSync(join(prior, 'real/events.jsonl'), 'utf8').trim().split('\n')
  .map((line) => JSON.parse(line)).filter((event) => event.kind === 'model.completed');
const spans = source.prepare('SELECT * FROM canonical_memory_ingestion_spans WHERE from_seq >= 3812 ORDER BY from_seq')
  .all().map(parseCanonicalIngestionState);
if (spans.length !== 2 || baseline.length !== 5) throw new Error('FIXTURE_CHANGED');
const previous = createSummaryRepo(pristine).getCheckpoint('taki');
const current = createSummaryRepo(source).getCheckpoint('taki');
const timeline = createTimelineRepo(pristine);
const retiring = timeline.rangeAscending('taki', previous.throughSeq, current.throughSeq);
const summaryPrompt = buildCompactionPrompt(sanitizeCompactionText(previous.text), renderSafeTranscript(retiring), new Date(baseline[4].at));
const expectedTexts = spans.flatMap((span) => [JSON.stringify(span.gate), JSON.stringify(span.extraction.facts.map((fact) => ({
  layer: fact.layer, content: fact.content, importance: fact.importance, ...(fact.disclosure ? { disclosure: fact.disclosure } : {}),
})))]).concat(current.text);
const configured = loadProviderConfig(createConfigSource({ env: process.env, repo: createConfigRepo(source) }).env());
if (loadUtilityConfig(createConfigSource({ env: process.env, repo: createConfigRepo(source) }).env())) throw new Error('UTILITY_ROUTE_CHANGED');
let ordinal = control ? 4 : 0;
let active;
let ledger;
let utility;
const observations = [];
const prepared = [];
const realModel = createOpenAICompatible({ name: 'taki-provider', baseURL: configured.baseUrl, apiKey: configured.apiKey,
  transformRequestBody: (body) => ({ ...body, thinking: { type: 'disabled' } }),
}).languageModel(configured.model);
const observedModel = new Proxy(realModel, { get(target, key) {
  if (key !== 'doGenerate') return Reflect.get(target, key, target);
  return async (params) => {
    if (!active || active.dispatched) throw new Error('NO_REPEAT_DISPATCH');
    active.dispatched = true;
    const index = ordinal++;
    const expected = baseline[index];
    const promptDigest = hash(params.prompt);
    if (!expected || promptDigest !== expected.promptDigest) throw new Error('PROMPT_DIGEST_MISMATCH');
    prepared.push({ ordinal: index + 1, label: expected.label, promptDigest, baseline: expected, prompt: params.prompt });
    if (mode === 'prepare') return { content: [{ type: 'text', text: expectedTexts[index] }],
      finishReason: { unified: 'stop', raw: 'stop' }, usage: expected.sdkUsage, warnings: [] };
    const startedAt = new Date().toISOString();
    const result = await target.doGenerate({ ...params, abortSignal: AbortSignal.timeout(300_000) });
    const observation = { ordinal: index + 1, label: expected.label, promptDigest, startedAt,
      finishedAt: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(startedAt), usage: result.usage,
      responseId: result.response?.id, finishReason: result.finishReason, content: result.content };
    observations.push(observation);
    save(control ? 'summary-control-calls.json' : 'calls.json', observations);
    console.log(JSON.stringify({ ordinal: index + 1, label: expected.label, promptDigest, elapsedMs: observation.elapsedMs, usage: result.usage }));
    return result;
  };
} });
try {
  if (mode !== 'prepare') {
    const evidence = JSON.parse(readFileSync(join(output, 'prepared.json'), 'utf8'));
    if (evidence.length !== 5 || evidence.some((item, i) => item.promptDigest !== baseline[i].promptDigest)) throw new Error('PREPARE_REQUIRED');
    ledger = openDatabase({ path: join(output, 'experiment.db'), migrations: MIGRATIONS });
    if (ledger.prepare('SELECT count(*) n FROM auxiliary_model_calls').get().n !== (control ? 5 : 0)) throw new Error('EXPERIMENT_ALREADY_STARTED');
  }
  const repo = ledger ? createAuxiliaryUsageRepo(ledger) : null;
  const meter = repo ? createAuxiliaryUsageMeter({ repo, logger: log }) : undefined;
  utility = createUtilitySlot({ mainModel: observedModel, config: null, logger: log, usageMeter: meter });
  const slot = { ...utility, run: (label, task) => utility.run(`experiment:nonthinking:${label}`, task) };
  const ingestion = createCanonicalIngestionModel(slot);
  const results = [];
  for (const span of control ? [] : spans) {
    active = { dispatched: false };
    const gate = await ingestion.gate(span.source);
    results.push({ kind: 'gate', sourceFrom: span.source.fromSeq, sourceThrough: span.source.throughSeq, baseline: span.gate, result: gate });
    active = { dispatched: false };
    const facts = await ingestion.extract({ source: span.source, gate: span.gate });
    results.push({ kind: 'extraction', sourceFrom: span.source.fromSeq, fixedGate: span.gate, baseline: span.extraction.facts, result: facts });
  }
  active = { dispatched: false };
  const summary = await slot.run(control ? 'compact-output-control' : 'compact', () => generateText({
    model: slot.model, prompt: summaryPrompt, maxRetries: 0, ...(control ? { maxOutputTokens: 65_536 } : {}),
  }));
  if (!summary || ordinal !== 5) throw new Error('EXPERIMENT_INCOMPLETE');
  results.push({ kind: 'summary', sourceFrom: previous.throughSeq, sourceThrough: current.throughSeq,
    baseline: current.text, result: summary.text, finishReason: summary.finishReason, maxOutputTokens: control ? 65_536 : null });
  save(mode === 'prepare' ? 'prepared.json' : control ? 'summary-control.json' : 'results.json', mode === 'prepare' ? prepared : results);
  if (mode === 'prepare') save('quality-fixture.json', { spans, previous, retiring, current });
  if (repo) save(control ? 'ledger-all.json' : 'ledger.json', repo.query({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z', limit: 100 }));
  console.log(JSON.stringify({ mode, exactPromptMatches: control ? 1 : ordinal, completed: true }));
} finally {
  await utility?.stop();
  ledger?.close();
  source.close();
  pristine.close();
}
