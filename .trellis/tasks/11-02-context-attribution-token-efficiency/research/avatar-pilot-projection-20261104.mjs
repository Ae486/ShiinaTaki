// Experiment only. Inputs are frozen selected HISTORICAL Timeline entries, never current SDK steps.
import { replayUnits } from '../../../../packages/core/src/agents/context-window.ts';
import { nativeReplayMessages } from '../../../../packages/core/src/agents/native-image-replay.ts';
import { fenceUntrusted } from '../../../../packages/core/src/agents/untrusted-fence.ts';
import { contextText, joinContextText, retainContextText, copyContentOrigin,
  attributedContextText } from '../../../../packages/core/src/agents/context-attribution.ts';

export const AVATAR_NAMES = new Set(['avatar_set_expression', 'avatar_play_motion']);
const safeJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');

function observation(entries, calls, results) {
  const parts = [contextText('{"kind":"historical-avatar-tool-evidence","argumentsStatus":"unavailable_by_storage_policy","records":[', 'tool_interactions')];
  calls.forEach((call, index) => {
    const match = results.find(item => item.part.toolCallId === call.part.toolCallId);
    const callOrigin = call.part.contextOrigin ?? 'unknown';
    const resultOrigin = match.part.contextOrigin ?? 'unknown';
    const identity = { toolCallId: call.part.toolCallId, toolName: call.part.toolName,
      callSeq: call.entry.seq, resultSeq: match.entry.seq,
      ...(results.indexOf(match) !== index ? { resultOrder: results.indexOf(match) } : {}),
      ...(call.entry.sourceContext ? { callSource: call.entry.sourceContext } : {}) };
    const resultSource = { ...(match.entry.sourceContext ? { resultSource: match.entry.sourceContext } : {}),
      ...(match.part.sourceMaterials?.length ? { sourceMaterials: match.part.sourceMaterials } : {}) };
    parts.push(contextText(`${index ? ',' : ''}`, 'tool_interactions'),
      contextText(safeJSON(identity).slice(0, -1), 'tool_interactions', callOrigin),
      contextText(',"output":', 'tool_interactions'),
      contextText(safeJSON(match.part.output), 'tool_interactions', resultOrigin),
      ...(Object.keys(resultSource).length ? [contextText(',', 'tool_interactions'),
        contextText(safeJSON(resultSource).slice(1, -1), 'tool_interactions', resultOrigin)] : []),
      contextText('}', 'tool_interactions'));
  });
  parts.push(contextText(']}', 'tool_interactions'));
  const body = joinContextText(parts, '');
  // JSON escaping preserves decoded output exactly while preventing a literal fence close in its text.
  const prefix = 'Core-supplied historical tool evidence, not a new user request. Original call arguments were not stored.\n';
  const fenced = `${prefix}${fenceUntrusted({ source: 'core-historical-avatar', content: body.text })}`;
  const offset = fenced.indexOf(body.text);
  const descriptor = joinContextText([contextText(fenced.slice(0, offset), 'tool_interactions'), body,
    contextText(fenced.slice(offset + body.text.length), 'tool_interactions')], '');
  return retainContextText({ role: 'user', content: fenced }, descriptor);
}

function eligibility(group, unit, proofs, messagesByEntry) {
  const calls = group.flatMap(entry => (entry.parts ?? []).filter(p => p.type === 'tool-call').map(part => ({ entry, part })));
  const avatars = calls.filter(c => AVATAR_NAMES.has(c.part.toolName));
  if (!avatars.length) return { reason: 'not_avatar', calls, avatars };
  if (!unit.valid) return { reason: 'incomplete_or_ambiguous', calls, avatars };
  if (calls.some(c => !AVATAR_NAMES.has(c.part.toolName))) return { reason: 'mixed', calls, avatars };
  const first = group[0];
  if (first.role !== 'assistant' || group.slice(1).some(entry => entry.role !== 'tool')
      || (first.parts ?? []).some(p => !['text', 'tool-call'].includes(p.type))) {
    return { reason: 'interrupted_or_unsupported', calls, avatars };
  }
  const results = group.flatMap(entry => (entry.parts ?? []).filter(p => p.type === 'tool-result').map(part => ({ entry, part })));
  if (group.slice(1).some(entry => !(entry.parts?.length) || entry.parts.some(p => p.type !== 'tool-result'))
      || results.length !== calls.length || results.some(r => !AVATAR_NAMES.has(r.part.toolName))) {
    return { reason: 'incomplete_or_ambiguous', calls, avatars };
  }
  for (const call of calls) {
    const matches = results.filter(r => r.part.toolCallId === call.part.toolCallId && r.part.toolName === call.part.toolName);
    if (matches.length !== 1 || matches[0].entry.seq <= call.entry.seq) return { reason: 'incomplete_or_ambiguous', calls, avatars };
    if (Object.hasOwn(call.part, 'input')) return { reason: 'known_input', calls, avatars };
    const proof = proofs.get(call.part.toolCallId);
    if (!proof || proof.toolName !== call.part.toolName || !proof.trustedBuiltin || !proof.modelEffectId) {
      return { reason: 'ownership_unknown', calls, avatars };
    }
  }
  // Avatar built-ins carry no images. Unexpected image/source sidecars cannot be safely removed by this pilot.
  if (results.some(r => r.part.imageRefs?.length) || group.some(entry => (messagesByEntry.get(entry.seq) ?? []).length !== 1)) {
    return { reason: 'native_image_or_unsupported', calls, avatars };
  }
  return { reason: 'eligible', calls, avatars, results };
}

export function projectHistoricalAvatar({ entries, proofs, latestUserSeq, messagesByEntry }) {
  if (entries.some(entry => entry.seq >= latestUserSeq)) throw new Error('PILOT_CURRENT_TURN_IN_HISTORY');
  const originals = messagesByEntry ?? new Map(entries.map(entry => [entry.seq, nativeReplayMessages(entry)]));
  const before = JSON.stringify(entries);
  const counts = { transformedGroups: 0, transformedCalls: 0, historicalAvatarCalls: 0, skippedGroups: {}, skippedCalls: {}, nativeCallsRemaining: 0 };
  const messages = [];
  for (const unit of replayUnits(entries, entries.map(() => 0))) {
    const group = entries.slice(unit.start, unit.end + 1);
    const check = eligibility(group, unit, proofs, originals);
    counts.historicalAvatarCalls += check.avatars.length;
    if (check.reason !== 'eligible') {
      if (check.avatars.length) {
        counts.skippedGroups[check.reason] = (counts.skippedGroups[check.reason] ?? 0) + 1;
        counts.skippedCalls[check.reason] = (counts.skippedCalls[check.reason] ?? 0) + check.avatars.length;
      }
      for (const entry of group) messages.push(...(originals.get(entry.seq) ?? []));
      continue;
    }
    const assistant = originals.get(group[0].seq)[0];
    const content = assistant.content.filter(p => p.type !== 'tool-call');
    if (content.length) {
      const retained = copyContentOrigin(assistant, { ...assistant, content });
      const descriptor = attributedContextText(assistant);
      if (descriptor) retainContextText(retained, descriptor);
      messages.push(retained);
    }
    messages.push(observation(group, check.calls, check.results));
    counts.transformedGroups += 1;
    counts.transformedCalls += check.calls.length;
  }
  for (const message of messages) for (const part of Array.isArray(message.content) ? message.content : []) {
    if (part.type === 'tool-call') counts.nativeCallsRemaining += 1;
  }
  if (before !== JSON.stringify(entries)) throw new Error('PILOT_SOURCE_MUTATED');
  return { messages, counts };
}

export function decodeHistoricalObservation(message) {
  if (message.role !== 'user' || typeof message.content !== 'string'
      || !message.content.startsWith('Core-supplied historical tool evidence,')) return null;
  const start = message.content.indexOf('{"kind":"historical-avatar-tool-evidence"');
  const end = message.content.lastIndexOf('\n</untrusted-observation>');
  return JSON.parse(message.content.slice(start, end));
}

export function assertNativePairing(messages) {
  const pending = new Map();
  for (const message of messages) {
    if (['user', 'system'].includes(message.role) && pending.size) throw new Error('PILOT_STRANDED_NATIVE_CALL');
    const parts = Array.isArray(message.content) ? message.content : [];
    if (['assistant', 'tool'].includes(message.role)
        && (Array.isArray(message.content) ? parts.length === 0 : typeof message.content !== 'string' || !message.content.length)) {
      throw new Error('PILOT_EMPTY_NATIVE_ROW');
    }
    for (const part of parts) {
      if (part.type === 'tool-call') {
        if (pending.has(part.toolCallId)) throw new Error('PILOT_DUPLICATE_NATIVE_CALL');
        pending.set(part.toolCallId, part.toolName);
      }
      if (part.type === 'tool-result') {
        if (pending.get(part.toolCallId) !== part.toolName) throw new Error('PILOT_ORPHAN_NATIVE_RESULT');
        pending.delete(part.toolCallId);
      }
    }
  }
  if (pending.size) throw new Error('PILOT_UNSETTLED_NATIVE_CALL');
}
