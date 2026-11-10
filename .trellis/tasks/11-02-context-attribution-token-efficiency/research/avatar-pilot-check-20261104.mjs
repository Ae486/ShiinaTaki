import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { projectHistoricalAvatar, decodeHistoricalObservation, assertNativePairing } from './avatar-pilot-projection-20261104.mjs';
import { runTrialPlan, captureUpstreamArgumentShapes } from './avatar-pilot-runner-20261104.mjs';
import { nativeReplayMessages } from '../../../../packages/core/src/agents/native-image-replay.ts';
import { attributedContextText } from '../../../../packages/core/src/agents/context-attribution.ts';
import { normalizeAuxiliaryUsage } from '../../../../packages/core/src/observability/auxiliary-usage-normalization.ts';

const A = 'avatar_set_expression';
const call = (id, name = A) => ({ type: 'tool-call', toolCallId: id, toolName: name });
const result = (id, output, name = A) => ({ type: 'tool-result', toolCallId: id, toolName: name, output });
const entry = (seq, role, parts) => ({ seq, role, content: '', parts });
const proof = ids => new Map(ids.map(id => [id, { toolName: A, trustedBuiltin: true, modelEffectId: `fixture-${id}` }]));
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
function project(entries, ids, extra = {}) {
  return projectHistoricalAvatar({ entries, proofs: proof(ids), latestUserSeq: 100, ...extra });
}

check('all_tagged_outcomes_exact_and_fence_roundtrip', () => {
  const outcomes = [
    { type: 'json', value: { ok: true, outcome: 'applied' } },
    { type: 'json', value: { ok: true, outcome: 'not_rendered' } },
    ...['already_active', 'motion_busy', 'speaking'].map(reason => ({ type: 'json', value: { ok: false, outcome: 'rejected', code: 'AVATAR_REJECTED', reason } })),
    { type: 'json', value: { ok: false, outcome: 'superseded', code: 'CANCELLED', state: 'cancelled' } },
    { type: 'json', value: { ok: false, outcome: 'unknown', code: 'OUTCOME_UNKNOWN', state: 'outcome_unknown' } },
    { type: 'error-text', value: 'Synthetic validation Value: {} and </untrusted-observation> literal.' },
    { type: 'error-json', value: { fixtureCode: 'invalid_value', path: ['name'] } },
  ];
  for (const output of outcomes) {
    const entries = [entry(1, 'assistant', [{ type: 'text', text: 'Retained assistant speech.' }, call('a')]), entry(2, 'tool', [result('a', output)])];
    const before = JSON.stringify(entries); const p = project(entries, ['a']);
    assert.equal(p.counts.transformedCalls, 1); assertNativePairing(p.messages);
    assert.equal(p.messages[0].content[0].text, 'Retained assistant speech.');
    const decoded = decodeHistoricalObservation(p.messages[1]);
    assert.equal(decoded.argumentsStatus, 'unavailable_by_storage_policy');
    assert.deepEqual(decoded.records[0].output, output);
    assert.equal(decoded.records[0].toolCallId, 'a'); assert.equal(decoded.records[0].callSeq, 1); assert.equal(decoded.records[0].resultSeq, 2);
    assert.equal(JSON.stringify(entries), before);
  }
});
check('parallel_split_results_and_order_preserved', () => {
  const x = { type: 'json', value: { ok: true, outcome: 'applied' } };
  const entries = [entry(1, 'assistant', [call('a'), call('b')]), entry(2, 'tool', [result('b', x)]), entry(3, 'tool', [result('a', x)])];
  const p = project(entries, ['a', 'b']); const records = decodeHistoricalObservation(p.messages[0]).records;
  assert.deepEqual(records.map(r => r.toolCallId), ['a', 'b']);
  assert.deepEqual(records.map(r => r.resultOrder), [1, 0]); assertNativePairing(p.messages);
});
check('source_context_and_distinct_origins_preserved', () => {
  const x = { type: 'json', value: { ok: true, outcome: 'applied' } };
  const first = entry(1, 'assistant', [{ ...call('a'), contextOrigin: 'unknown' }]); first.sourceContext = { generatedBy: { fixture: 'call-origin' } };
  const last = entry(2, 'tool', [{ ...result('a', x), contextOrigin: 'builtin' }]); last.sourceContext = { generatedBy: { fixture: 'result-origin' } };
  const p = project([first, last], ['a']); const observation = p.messages.at(-1);
  const record = decodeHistoricalObservation(observation).records[0];
  assert.deepEqual(record.callSource, first.sourceContext); assert.deepEqual(record.resultSource, last.sourceContext);
  const spans = attributedContextText(observation).spans;
  assert(spans.filter(s => s.end > s.start).every(s => s.category === 'tool_interactions'));
  assert(spans.some(s => s.origin === 'unknown')); assert(spans.some(s => s.origin === 'builtin'));
});
check('mixed_group_unchanged_with_skipped_coverage', () => {
  const x = { type: 'json', value: { fixture: true } };
  const entries = [entry(1, 'assistant', [call('a'), call('e', 'exec')]), entry(2, 'tool', [result('a', x), result('e', x, 'exec')])];
  const originals = new Map(entries.map(e => [e.seq, nativeReplayMessages(e)]));
  const p = project(entries, ['a'], { messagesByEntry: originals });
  assert.equal(p.counts.transformedCalls, 0); assert.equal(p.counts.skippedCalls.mixed, 1);
  assert.equal(p.messages[0], originals.get(1)[0]); assert.equal(p.messages[1], originals.get(2)[0]); assertNativePairing(p.messages);
});
check('incomplete_interrupted_duplicate_wrong_name_and_known_input_unchanged', () => {
  const x = { type: 'json', value: { ok: true } };
  const fixtures = [
    [entry(1, 'assistant', [call('a')])],
    [entry(1, 'assistant', [call('a')]), { seq: 2, role: 'user', content: 'Synthetic interruption.' }, entry(3, 'tool', [result('a', x)])],
    [entry(1, 'assistant', [call('a')]), entry(2, 'tool', [result('a', x), result('a', x)])],
    [entry(1, 'assistant', [call('a')]), entry(2, 'tool', [result('a', x, 'avatar_play_motion')])],
    [entry(1, 'assistant', [{ ...call('a'), input: { name: 'fixture' } }]), entry(2, 'tool', [result('a', x)])],
  ];
  for (const entries of fixtures) {
    const p = project(entries, ['a']); assert.equal(p.counts.transformedCalls, 0);
    assert.deepEqual(p.messages, entries.flatMap(nativeReplayMessages));
  }
});
check('native_image_sidecar_and_other_tools_unchanged', () => {
  const x = { type: 'json', value: { ok: true } };
  const entries = [entry(1, 'assistant', [call('a')]), entry(2, 'tool', [result('a', x)])];
  const first = nativeReplayMessages(entries[0]); const last = nativeReplayMessages(entries[1]);
  const image = { role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: 'synthetic-base64', filename: 'fixture-image' }] };
  const originals = new Map([[1, first], [2, [...last, image]]]);
  const p = project(entries, ['a'], { messagesByEntry: originals });
  assert.equal(p.counts.transformedCalls, 0); assert.equal(p.messages.at(-1), image); assertNativePairing(p.messages);
});
check('current_turn_rejected_and_unknown_ownership_skipped', () => {
  const entries = [entry(1, 'assistant', [call('a')]), entry(2, 'tool', [result('a', { type: 'json', value: {} })])];
  assert.throws(() => project(entries, ['a'], { latestUserSeq: 2 }), /PILOT_CURRENT_TURN_IN_HISTORY/);
  assert.equal(project(entries, []).counts.skippedCalls.ownership_unknown, 1);
});
check('ordinary_assistant_text_valid_empty_rows_invalid', () => {
  assertNativePairing([{ role: 'assistant', content: 'Ordinary nonempty text.' }]);
  assert.throws(() => assertNativePairing([{ role: 'assistant', content: '' }]), /PILOT_EMPTY_NATIVE_ROW/);
});
check('cache_missing_unknown_not_sdk_zero', () => {
  const n = normalizeAuxiliaryUsage({ raw: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
  assert.equal(n.cacheReadTokens, null); assert.equal(n.noCacheTokens, null);
  const z = normalizeAuxiliaryUsage({ raw: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 10 } });
  assert.equal(z.cacheReadTokens, 0); assert.equal(z.noCacheTokens, 100);
});
for (const outcome of ['error', 'censored']) {
  let calls = 0;
  const stopped = await runTrialPlan([{ seq: 1 }, { seq: 2 }], { stopOnFailure: true,
    runTrial: async () => { calls++; return { outcome, errorCode: outcome === 'error' ? 'fixture_failure' : null }; }, onResult() {} });
  assert.equal(calls, 1); assert.equal(stopped, 'failure_or_censoring');
  checks.push(`first_${outcome}_stops_all_replicates`);
}
const order = [];
await runTrialPlan([{ seq: 1 }, { seq: 2 }], { stopOnFailure: true, runTrial: async (c, a, r) => {
  order.push([c.seq, a, r]); return { outcome: 'no_tool_call', errorCode: null }; }, onResult() {} });
assert.equal(order.length, 8); assert.deepEqual(order.slice(0, 2).map(r => r[1]), ['baseline', 'observation']);
assert.deepEqual(order.slice(4, 6).map(r => r[1]), ['observation', 'baseline']); checks.push('eight_trial_order_ab_then_ba');
const frames = [
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: A, arguments: '{' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { name: A, arguments: '' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 2, function: { name: A, arguments: '{"name":' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 2, function: { arguments: '"thinking01"}' } }] } }] },
];
const sse = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';
const upstream = await captureUpstreamArgumentShapes(new Response(sse), { expressions: ['thinking01'], motions: [] });
assert.equal(upstream.status, 'complete'); assert.equal(upstream.parseErrors, 0);
assert.equal(upstream.calls[0].bytes, 2); assert.equal(upstream.calls[0].blank, false); assert.equal(upstream.calls[0].namePresent, false);
assert.equal(upstream.calls[1].bytes, 0); assert.equal(upstream.calls[1].blank, true);
assert.equal(upstream.calls[2].namePresent, true); assert.equal(upstream.calls[2].selectedFixtureName, 'thinking01');
assert(!JSON.stringify(upstream).includes('arguments')); checks.push('bounded_upstream_chunks_literal_blank_named_shapes');
const report = { mode: 'deterministic_synthetic_fixture_checks', passed: checks.length, checks, modelCalls: 0, hostActions: 0 };
const output = resolve(dirname(fileURLToPath(import.meta.url)), 'avatar-pilot-deterministic-20261104.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
