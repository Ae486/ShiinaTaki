// Read-only dry run by default. Only the parent may invoke --live after endpoint/cost review.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ToolLoopAgent, isStepCount, wrapLanguageModel } from '../../../../packages/core/node_modules/ai/dist/index.js';
import { createOpenAICompatible } from '../../../../packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js';
import { createTimelineRepo } from '../../../../packages/core/src/db/timeline-repo.ts';
import { createConversationStore } from '../../../../packages/core/src/agents/conversation-store.ts';
import { nativeReplayMessages } from '../../../../packages/core/src/agents/native-image-replay.ts';
import { createNativeImageAttempt } from '../../../../packages/core/src/agents/native-image-attempt.ts';
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from '../../../../packages/core/src/agents/chat-agent.ts';
import { createPersonaProvider } from '../../../../packages/core/src/memory/persona-provider.ts';
import { createAvatarVocabulary } from '../../../../packages/core/src/avatar/avatar-vocabulary.ts';
import { createAvatarTools } from '../../../../packages/core/src/avatar/avatar-tools.ts';
import { presentationTailStop } from '../../../../packages/core/src/avatar/presentation-stop.ts';
import { estimateTokens, estimateMessagesTokens } from '../../../../packages/core/src/memory/token-estimator.ts';
import { contextText, joinContextText } from '../../../../packages/core/src/agents/context-attribution.ts';
import { measureRequestComposition } from '../../../../packages/core/src/agents/request-composition.ts';
import { companionTaskGuidance } from '../../../../packages/core/src/agents/companion-task-guidance.ts';
import { renderCurrentTime, renderDayDate } from '../../../../packages/core/src/time/time-context.ts';
import { createConfigSource } from '../../../../packages/core/src/config/config-source.ts';
import { createConfigRepo } from '../../../../packages/core/src/db/config-repo.ts';
import { loadProviderConfig } from '../../../../packages/core/src/config/provider-config.ts';
import { normalizeAuxiliaryUsage } from '../../../../packages/core/src/observability/auxiliary-usage-normalization.ts';
import { AVATAR_NAMES, projectHistoricalAvatar, assertNativePairing } from './avatar-pilot-projection-20261104.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const EXPECTED_SHA = 'f8b8525f756cf28db62264307739f91358dd156ea60b9f48d1f2b0dd51bb9b93';
const hash = value => createHash('sha256').update(value).digest('hex');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const SINGLE_UPSTREAM = process.argv.includes('--single-late-baseline');
const MAX_PHYSICAL = SINGLE_UPSTREAM ? 3 : 24, MAX_STEPS = 3, MAX_OUTPUT = 1024, MAX_ESTIMATED_REAL_INPUT = 131000;
const DEADLINE_MS = 60000;
const KNOWN_ERRORS = new Set(['PILOT_SOURCE_HASH', 'PILOT_REPLAY_SELECTION', 'PILOT_CURRENT_TURN_IN_HISTORY',
  'PILOT_BUDGET_EXHAUSTED', 'PILOT_INPUT_LIMIT', 'PILOT_ENDPOINT_CHANGED', 'PILOT_PRIVATE_PATH',
  'PILOT_OUTPUT_PATH', 'PILOT_MODEL_FAILURE', 'PILOT_NETWORK_FAILURE', 'PILOT_SOURCE_MUTATED',
  'PILOT_BUDGET_BASELINE', 'PILOT_DIAGNOSTIC_TASK']);

function argumentShape(input, vocabulary) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  let value; let parsed = false;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; parsed = true; } catch { /* shape only */ }
  const object = parsed && value !== null && typeof value === 'object' && !Array.isArray(value);
  return { bytes: Buffer.byteLength(text ?? ''), blank: typeof text === 'string' && text.trim() === '', jsonParsed: parsed,
    jsonKind: !parsed ? 'unparsed' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    namePresent: object && Object.hasOwn(value, 'name'), nameString: object && typeof value.name === 'string',
    nameInFixtureVocabulary: object && vocabulary.includes(value.name),
    selectedFixtureName: object && vocabulary.includes(value.name) ? value.name : null };
}

// Narrow local diagnostic: inspect a cloned SSE stream, return only aggregate argument shapes.
// No SSE body, argument string, reasoning or generated text is retained in its result.
export async function captureUpstreamArgumentShapes(response, vocab) {
  const reader = response.body?.getReader();
  if (!reader) return { status: 'body_missing', calls: [] };
  const decoder = new TextDecoder();
  const calls = new Map();
  let buffer = '', bytes = 0, parseErrors = 0, status = 'complete';
  const accept = frame => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let chunk; try { chunk = JSON.parse(data); } catch { parseErrors++; return; }
    for (const choice of chunk.choices ?? []) for (const tool of choice.delta?.tool_calls ?? []) {
      if (!Number.isSafeInteger(tool.index)) { parseErrors++; continue; }
      const key = `${choice.index ?? 0}:${tool.index}`;
      const row = calls.get(key) ?? { choiceIndex: choice.index ?? 0, toolIndex: tool.index, name: '', argument: '', chunks: 0, truncated: false };
      if (typeof tool.function?.name === 'string') row.name += tool.function.name;
      if (typeof tool.function?.arguments === 'string') {
        row.chunks++;
        if (row.argument.length + tool.function.arguments.length <= 65536) row.argument += tool.function.arguments;
        else row.truncated = true;
      }
      calls.set(key, row);
    }
  };
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 2000000) { status = 'capture_limit'; await reader.cancel(); break; }
      buffer += decoder.decode(item.value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        accept(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
      }
    }
    buffer += decoder.decode(); if (buffer.trim()) accept(buffer);
  } catch { status = 'stream_failure'; }
  const shapes = [...calls.values()].map(row => ({ choiceIndex: row.choiceIndex, toolIndex: row.toolIndex,
    tool: AVATAR_NAMES.has(row.name) ? row.name : 'other', chunks: row.chunks, truncated: row.truncated,
    ...argumentShape(row.argument, row.name === 'avatar_set_expression' ? vocab.expressions : vocab.motions) }));
  return { status, capturedBytes: bytes, parseErrors, calls: shapes };
}

function vocabularyFixture(db, toolName) {
  let found;
  for (const row of db.prepare("SELECT seq,created_at,parts FROM timeline_messages WHERE role='tool' AND parts IS NOT NULL ORDER BY seq").all()) {
    for (const p of JSON.parse(row.parts)) {
      if (p.toolName !== toolName || p.output?.type !== 'error-text') continue;
      try {
        const issues = JSON.parse(p.output.value.split('Error message: ')[1]);
        const values = issues.find(i => Array.isArray(i.values))?.values;
        if (values) found = { names: values, seq: row.seq, createdAt: row.created_at };
      } catch { /* Older errors without enum data remain unknown. */ }
    }
  }
  if (!found) return { names: [], seq: null, createdAt: null };
  return found;
}

function readContexts(db, promptDir, taskMode) {
  const summary = db.prepare('SELECT * FROM conversation_summary').get();
  const calibration = db.prepare("SELECT * FROM slot_window_state WHERE slot='main'").get();
  const budget = Math.floor(Math.floor(calibration.effective_window / calibration.factor) * 0.7);
  const base = createTimelineRepo(db);
  const expression = vocabularyFixture(db, 'avatar_set_expression');
  const motion = vocabularyFixture(db, 'avatar_play_motion');
  const vocab = { expressions: expression.names, motions: motion.names };
  const vocabulary = createAvatarVocabulary(); vocabulary.set('taki', vocab);
  const persona = createPersonaProvider({ promptDir });
  const proof = new Map();
  for (const row of db.prepare("SELECT payload_json FROM run_events WHERE kind='tool.result.settled'").all()) {
    const p = JSON.parse(row.payload_json);
    if (AVATAR_NAMES.has(p.toolName) && p.modelEffectId) proof.set(p.toolCallId,
      { toolName: p.toolName, modelEffectId: p.modelEffectId, trustedBuiltin: true });
  }
  const contexts = [];
  for (const seq of [4239, 4594]) {
    const repo = { ...base, pageBefore: input => base.pageBefore({ ...input, before: Math.min(seq + 1, input.before ?? seq + 1) }) };
    const projection = createConversationStore({ repo, window: { budget: () => budget }, summaries: {
      get: () => ({ throughSeq: summary.through_seq, text: summary.text }) } }).project('taki');
    const selected = db.prepare('SELECT seq,id,character_id,role,content,parts,created_at,source_context_json FROM timeline_messages WHERE seq>=? AND seq<=? ORDER BY seq')
      .all(projection.windowStartSeq, seq).map(r => ({ seq: r.seq, id: r.id, characterId: r.character_id,
        role: r.role, content: r.content, ...(r.parts ? { parts: JSON.parse(r.parts) } : {}),
        ...(r.source_context_json ? { sourceContext: JSON.parse(r.source_context_json) } : {}) }));
    if (projection.measurement.foldedTokensSaved || selected.length !== projection.measurement.selectedRows) throw new Error('PILOT_REPLAY_SELECTION');
    const historical = selected.filter(r => r.seq < seq);
    const byEntry = new Map(historical.map(entry => [entry.seq, nativeReplayMessages(entry)]));
    const changed = projectHistoricalAvatar({ entries: historical, proofs: proof, latestUserSeq: seq, messagesByEntry: byEntry });
    const hasSummary = projection.messages[0]?.content?.startsWith?.('<conversation-summary>');
    const head = hasSummary ? [projection.messages[0]] : [];
    const lastUser = projection.messages.at(-1);
    const source = db.prepare('SELECT r.started_at FROM primary_conversation_sources p JOIN runs r USING(run_id) WHERE p.original_user_seq=?').get(seq);
    const clock = Date.parse(source.started_at);
    const instructionText = joinContextText([contextText(CANONICAL_MEMORY_SYSTEM_PROMPT, 'instructions'),
      contextText(renderDayDate(clock, 'Asia/Shanghai'), 'runtime_context'), contextText('User timezone: Asia/Shanghai.', 'runtime_context'),
      contextText(persona.assistantLayer(), 'persona'), contextText(persona.persona('taki'), 'persona'),
      contextText(vocabulary.render('taki'), 'runtime_context'),
      contextText(companionTaskGuidance([...AVATAR_NAMES]), 'instructions')]);
    const current = { ...lastUser, content: `${lastUser.content}\n\n<turn-context>\n${renderCurrentTime(clock, 'Asia/Shanghai')}\n</turn-context>` };
    const control = taskMode === 'named-control' ? [{ role: 'user', content:
      'Synthetic controlled presentation check: set expression smile01 and give the result of 2 + 3 in one short Chinese sentence. This is the current test request.' }] : [];
    const baseline = [...head, ...historical.flatMap(r => byEntry.get(r.seq)), current, ...control];
    const observation = [...head, ...changed.messages, current, ...control];
    assertNativePairing(baseline); assertNativePairing(observation);
    contexts.push({ seq, baseline, observation, instructions: instructionText.text, instructionText,
      exposure: changed.counts, historicalRows: historical.length, summaryRevision: summary.revision,
      currentUserHash: hash(lastUser.content), currentUserChars: lastUser.content.length,
      taskMode, vocab, vocabularySources: { expression, motion }, calibration });
  }
  return contexts;
}

function stubTools(vocab, state) {
  const impossible = () => { throw new Error('PILOT_ACTION_EXECUTOR_CALLED'); };
  const tools = createAvatarTools({ characterId: 'taki', vocab, logger: { child() { return this; } },
    subscriptions: { count: impossible, publish: impossible }, outcomes: { open: impossible } });
  for (const tool of Object.values(tools)) tool.execute = async () => {
    state.stubExecutions += 1; return { ok: true, outcome: 'applied' };
  };
  return tools;
}

function offlineResponse() {
  const pieces = [{ choices: [{ index: 0, delta: { role: 'assistant', content: 'Offline serializer check.' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }];
  return new Response(pieces.map(p => `data: ${JSON.stringify({ id: 'offline', model: 'offline', ...p })}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
}

async function trial(context, arm, replicate, runtime) {
  const source = context[arm];
  const state = { preValidationAdapterArguments: [], parsedProposals: [], steps: [], dispatches: [],
    upstreamCaptures: [], stubExecutions: 0, textChars: 0, texts: [] };
  let latestWire; let requestIndex = 0;
  const tools = stubTools(context.vocab, state);
  const guardedFetch = async (url, init) => {
    if (runtime.physical >= MAX_PHYSICAL) throw new Error('PILOT_BUDGET_EXHAUSTED');
    const body = JSON.parse(init.body);
    const wireInputUnits = estimateTokens(JSON.stringify(body));
    if (Math.ceil(wireInputUnits * 1.2) > MAX_ESTIMATED_REAL_INPUT) throw new Error('PILOT_INPUT_LIMIT');
    const toolDefinitionsHash = hash(JSON.stringify(body.tools));
    const groupKey = `${context.seq}:${replicate}`;
    const existing = runtime.toolHashes.get(groupKey);
    if (existing && existing !== toolDefinitionsHash) throw new Error('PILOT_SCHEMA_ARM_MISMATCH');
    runtime.toolHashes.set(groupKey, toolDefinitionsHash);
    latestWire = { requestIndex: ++requestIndex, wireInputUnits, conservativeRealInputEstimate: Math.ceil(wireInputUnits * 1.2),
      toolDefinitionsHash, maxOutputTokens: body.max_completion_tokens ?? body.max_tokens ?? null,
      toolChoice: body.tool_choice ?? null, streaming: body.stream === true,
      historicalAvatarNativeCalls: body.messages.flatMap(m => m.tool_calls ?? []).filter(c => AVATAR_NAMES.has(c.function.name)).length };
    runtime.physical += 1;
    const record = { physicalIndex: runtime.physical, ...latestWire, status: 'dispatched', startedAt: new Date().toISOString() };
    state.dispatches.push(record);
    if (runtime.privateDir) writeFileSync(resolve(runtime.privateDir, `request-${runtime.fixturePrefix}${context.seq}-${replicate}-${arm}-${requestIndex}.json`),
      JSON.stringify(body, null, 2) + '\n'); // Body only; authorization headers/key are never stored.
    if (!runtime.live) {
      record.status = 'offline_stub'; const response = offlineResponse();
      if (runtime.upstream) state.upstreamCaptures.push({ requestIndex,
        promise: captureUpstreamArgumentShapes(response.clone(), context.vocab) });
      return response;
    }
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(DEADLINE_MS)]) : AbortSignal.timeout(DEADLINE_MS);
    try {
      const response = await fetch(url, { ...init, signal });
      record.httpStatus = response.status; record.status = response.ok ? 'response_headers' : 'http_failure';
      if (runtime.upstream && response.ok) state.upstreamCaptures.push({ requestIndex,
        promise: captureUpstreamArgumentShapes(response.clone(), context.vocab) });
      return response;
    } catch { record.status = 'network_failure'; throw new Error('PILOT_NETWORK_FAILURE'); }
  };
  const provider = createOpenAICompatible({ name: 'taki-provider', baseURL: runtime.provider.baseUrl,
    ...(runtime.live ? { apiKey: runtime.provider.apiKey } : {}), includeUsage: true, fetch: guardedFetch });
  const observed = wrapLanguageModel({ model: provider.languageModel(runtime.provider.model), middleware: {
    specificationVersion: 'v4', async wrapStream({ doStream }) {
      const response = await doStream();
      return { ...response, stream: response.stream.pipeThrough(new TransformStream({ transform(part, controller) {
        if (part.type === 'tool-call') state.preValidationAdapterArguments.push({ requestIndex,
          observationBoundary: 'compatible_adapter_before_sdk_validation_not_raw_upstream_sse',
          tool: AVATAR_NAMES.has(part.toolName) ? part.toolName : 'other',
          ...argumentShape(part.input, part.toolName === 'avatar_set_expression' ? context.vocab.expressions : context.vocab.motions) });
        if (part.type === 'finish') {
          const record = state.dispatches.at(-1);
          if (record) {
            record.normalizedProviderUsage = normalizeAuxiliaryUsage(part.usage);
            record.cacheReadKnown = record.normalizedProviderUsage.cacheReadTokens !== null;
            record.completedAt = new Date().toISOString();
            record.finishReason = part.finishReason?.unified ?? 'unknown';
            record.outputCensored = record.finishReason === 'length';
          }
        }
        if (part.type === 'response-metadata' && state.dispatches.at(-1)) {
          state.dispatches.at(-1).responseModelId = typeof part.modelId === 'string' ? part.modelId : null;
        }
        controller.enqueue(part);
      } })) };
    } } });
  const native = createNativeImageAttempt({ onDispatch(request, descriptors) {
    const composition = measureRequestComposition(request, { ...descriptors, instructions: context.instructionText,
      toolOrigins: new Map([...AVATAR_NAMES].map(n => [n, 'builtin'])) });
    state.latestComposition = { totalUnits: composition.totalUnits, categories: composition.categories, origins: composition.origins, coverage: composition.coverage };
  } });
  const agent = new ToolLoopAgent({ model: native.model(observed), instructions: context.instructions, tools,
    maxRetries: 0, maxOutputTokens: MAX_OUTPUT, stopWhen: [isStepCount(MAX_STEPS), presentationTailStop],
    prepareCall: settings => ({ ...settings, onError: () => undefined }),
    onStepEnd(event) {
      state.steps.push({ stepNumber: event.stepNumber, finishReason: event.finishReason, textChars: event.text?.length ?? 0,
        outputCensored: event.finishReason === 'length', toolCalls: event.toolCalls.length, usage: event.usage,
        responseModelId: event.response?.modelId ?? null, elapsedMs: event.performance?.responseTimeMs ?? null,
        composition: state.latestComposition });
      for (const call of event.toolCalls) state.parsedProposals.push({ stepNumber: event.stepNumber,
        tool: AVATAR_NAMES.has(call.toolName) ? call.toolName : 'other', invalid: call.invalid === true,
        ...argumentShape(call.input, call.toolName === 'avatar_set_expression' ? context.vocab.expressions : context.vocab.motions) });
    } });
  let errorCode = null;
  const started = Date.now();
  try {
    const result = await agent.stream({ messages: native.project(source) });
    for await (const part of result.stream) {
      if (part.type === 'text-delta') { state.textChars += part.text.length; state.texts.push(part.text); }
      if (part.type === 'error') { errorCode = 'PILOT_MODEL_FAILURE'; break; }
    }
  } catch (error) { errorCode = KNOWN_ERRORS.has(error?.message) ? error.message : 'PILOT_MODEL_FAILURE'; }
  const upstreamShapes = [];
  for (const capture of state.upstreamCaptures) upstreamShapes.push({ requestIndex: capture.requestIndex, ...await capture.promise });
  const expression = state.parsedProposals.filter(p => p.tool === 'avatar_set_expression');
  const validExpression = expression.some(p => !p.invalid && p.nameInFixtureVocabulary);
  const anyInvalid = expression.some(p => p.invalid);
  const censored = state.steps.some(s => s.outputCensored);
  const outcome = errorCode ? 'error' : censored ? 'censored' : !state.parsedProposals.length ? 'no_tool_call'
    : state.parsedProposals.some(p => p.tool === 'other') ? 'other_tool_request'
      : validExpression ? 'valid_expression_proposal' : expression.length ? 'invalid_expression_only' : 'motion_only';
  const result = { userSeq: context.seq, arm, replicate, taskMode: context.taskMode, outcome, errorCode,
    durationMs: Date.now() - started, physicalRequests: runtime.live ? state.dispatches.length : 0,
    offlineFetchInvocations: runtime.live ? 0 : state.dispatches.length,
    preValidationAdapterArguments: state.preValidationAdapterArguments,
    ...(runtime.upstream ? { upstreamArgumentShapes: upstreamShapes } : {}),
    parsedProposals: state.parsedProposals, steps: state.steps.map(s => ({ ...s, usage: sanitizedUsage(s.usage) })),
    dispatches: state.dispatches, stubExecutions: state.stubExecutions, hostActions: 0, validExpression,
    correctedExpression: anyInvalid && expression.some(p => !p.invalid && p.nameInFixtureVocabulary && p.stepNumber > expression[0].stepNumber),
    textChars: state.textChars, replyTextObserved: state.textChars > 0,
    substantiveReplyQuality: 'requires_private_review',
    stepBudgetReached: state.steps.length >= MAX_STEPS,
    endedByStepLimit: state.steps.length >= MAX_STEPS && state.steps.at(-1)?.finishReason === 'tool-calls',
    intendedNameCorrect: context.taskMode === 'named-control' ? expression.some(p => !p.invalid && p.selectedFixtureName === 'smile01') : null,
    substantiveFidelity: context.taskMode === 'named-control' ? (/5|五/.test(state.texts.join('')) ? 'check_answer_present' : 'check_answer_missing') : 'requires_private_review' };
  if (runtime.privateDir) writeFileSync(resolve(runtime.privateDir, `trial-${runtime.fixturePrefix}${context.seq}-${replicate}-${arm}.json`),
    JSON.stringify({ result, generatedText: state.texts.join(''), originalLatestUser: source.findLast(m => m.role === 'user')?.content }, null, 2) + '\n');
  return result;
}

function sanitizedUsage(usage) {
  if (!usage) return null;
  return { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null, inputTokenDetails: usage.inputTokenDetails ?? null,
    outputTokenDetails: usage.outputTokenDetails ?? null };
}

export async function runTrialPlan(contexts, { runTrial, onResult, stopOnFailure }) {
  for (let replicate = 1; replicate <= 2; replicate++) for (const context of contexts) {
    for (const arm of replicate === 1 ? ['baseline', 'observation'] : ['observation', 'baseline']) {
      const result = await runTrial(context, arm, replicate);
      await onResult(result);
      if (stopOnFailure && (result.errorCode || result.outcome === 'censored')) return 'failure_or_censoring';
    }
  }
  return null;
}

async function main() {
  const dbPath = resolve(arg('--db') ?? resolve(ROOT, 'target/context-analysis-20261104/conversation-115757.db'));
  const output = resolve(arg('--output') ?? resolve(ROOT, `.trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-${SINGLE_UPSTREAM ? 'upstream' : 'dryrun'}-20261104.json`));
  if (!output.startsWith(resolve(ROOT, '.trellis/tasks/11-02-context-attribution-token-efficiency/research') + '/')
      && !output.startsWith(resolve(ROOT, '.trellis/tasks/11-02-context-attribution-token-efficiency/research') + '\\')) throw new Error('PILOT_OUTPUT_PATH');
  if (!basename(output).startsWith('avatar-pilot')) throw new Error('PILOT_OUTPUT_PATH');
  if (SINGLE_UPSTREAM && basename(output) === 'avatar-pilot-live-20261104.json') throw new Error('PILOT_OUTPUT_PATH');
  if (hash(readFileSync(dbPath)) !== EXPECTED_SHA) throw new Error('PILOT_SOURCE_HASH');
  const db = new DatabaseSync(dbPath, { readOnly: true }); db.exec('PRAGMA query_only=ON; BEGIN');
  const live = process.argv.includes('--live');
  let privateDir;
  if (arg('--fixtures-dir')) {
    privateDir = resolve(arg('--fixtures-dir'));
    if (privateDir !== resolve(ROOT, 'target/avatar-pilot-20261104')) throw new Error('PILOT_PRIVATE_PATH');
    mkdirSync(privateDir, { recursive: true });
  }
  if (live && !privateDir) throw new Error('PILOT_PRIVATE_PATH');
  const provider = live ? loadProviderConfig(createConfigSource({ env: process.env, repo: createConfigRepo(db) }).env())
    : { baseUrl: 'https://offline.invalid/v1', model: 'offline' };
  if (live && (new URL(provider.baseUrl).origin !== 'https://api.deepseek.com' || provider.model !== 'deepseek-v4-flash')) throw new Error('PILOT_ENDPOINT_CHANGED');
  const taskMode = arg('--task') === 'named-control' ? 'named-control' : 'original';
  if (SINGLE_UPSTREAM && taskMode !== 'original') throw new Error('PILOT_DIAGNOSTIC_TASK');
  const contexts = readContexts(db, resolve(arg('--prompt-dir') ?? resolve(ROOT, 'prompt')), taskMode)
    .filter(c => !SINGLE_UPSTREAM || c.seq === 4594);
  let priorPhysicalRequests = 0;
  if (SINGLE_UPSTREAM && live) {
    priorPhysicalRequests = JSON.parse(readFileSync(resolve(ROOT, '.trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-live-20261104.json'), 'utf8')).physicalRequests;
    if (priorPhysicalRequests !== 12) throw new Error('PILOT_BUDGET_BASELINE');
  }
  const runtime = { live, provider, physical: 0, privateDir, toolHashes: new Map(),
    upstream: SINGLE_UPSTREAM, fixturePrefix: SINGLE_UPSTREAM ? 'upstream-' : '' };
  const report = { generatedAt: new Date().toISOString(), mode: live ? 'bounded_live_parent_run' : 'offline_streaming_fetch_stub',
    sourceSHA256: EXPECTED_SHA, taskMode, diagnostic: SINGLE_UPSTREAM ? 'single_late_baseline_upstream_shape' : null,
    priorPhysicalRequests, profile: 'controlled_avatar_only_current_source_templates_historical_vocabulary_fixture',
    settings: { maxRetries: 0, maxOutputTokens: MAX_OUTPUT, maxSteps: MAX_STEPS, maxPhysicalRequests: MAX_PHYSICAL,
      physicalDeadlineMs: DEADLINE_MS, conservativeInputLimit: MAX_ESTIMATED_REAL_INPUT, streaming: true, forcedToolChoice: false },
    contexts: contexts.map(c => ({ userSeq: c.seq, currentUserHash: c.currentUserHash, currentUserChars: c.currentUserChars,
      exposure: c.exposure, historicalRows: c.historicalRows, summaryRevision: c.summaryRevision,
      baselineHistoryUnits: estimateMessagesTokens(c.baseline), observationHistoryUnits: estimateMessagesTokens(c.observation),
      instructionUnits: estimateTokens(c.instructions), vocabularySources: { expression: { count: c.vocab.expressions.length, seq: c.vocabularySources.expression.seq },
        motion: { count: c.vocab.motions.length, seq: c.vocabularySources.motion.seq, currentRuntimeVocabularyUnverified: true } } })),
    reconstructionGaps: ['Not exact historical wire: current source/persona, latest fixed calibration and preserved original user plus reconstructed time.',
      'Historical assembled/pinned/recall memory and volatile observation tail unavailable; omitted equally from both arms, not replaced with future memories.',
      'Historical full tool definitions unavailable; controlled identical two-Avatar schemas only. Motion uses latest retained historical enum, not proven current live vocabulary.',
      'Historical valid arguments unavailable; observation preserves exact retained outputs and explicit omission. Original mode semantic fit and answer quality need local review.'],
    trials: [] };
  // AB then BA per boundary; both original tasks get exactly the same settings within each pair.
  const onResult = result => {
      report.trials.push(result);
      report.physicalRequests = live ? runtime.physical : 0;
      report.offlineFetchInvocations = live ? 0 : runtime.physical;
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  };
  if (SINGLE_UPSTREAM) onResult(await trial(contexts[0], 'baseline', 1, runtime));
  else report.stoppedEarly = await runTrialPlan(contexts, { stopOnFailure: live,
    runTrial: (context, arm, replicate) => trial(context, arm, replicate, runtime), onResult });
  db.close();
  if (hash(readFileSync(dbPath)) !== EXPECTED_SHA) throw new Error('PILOT_SOURCE_MUTATED');
  report.sourceUnchanged = true; report.physicalRequests = live ? runtime.physical : 0;
  report.offlineFetchInvocations = live ? 0 : runtime.physical;
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, mode: report.mode, trials: report.trials.length,
    physicalRequests: report.physicalRequests, offlineFetchInvocations: report.offlineFetchInvocations,
    outcomes: report.trials.map(r => r.outcome), sourceUnchanged: true }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ errorCode: KNOWN_ERRORS.has(error?.message) ? error.message : 'PILOT_MODEL_FAILURE' })); process.exitCode = 1; });
}
