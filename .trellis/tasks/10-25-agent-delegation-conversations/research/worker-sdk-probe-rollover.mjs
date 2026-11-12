// Installed-SDK-only pressure rollover probe. No production loop, database or provider calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
assert.equal(path.resolve(root).toLowerCase(), path.resolve('H:/TakiAgent-worktrees/t4').toLowerCase());
const requireCore = createRequire(path.join(root, 'packages/core/package.json'));
const { ToolLoopAgent, isLoopFinished, jsonSchema, simulateReadableStream, tool } = await import(pathToFileURL(requireCore.resolve('ai')).href);
const { MockLanguageModelV4 } = await import(pathToFileURL(requireCore.resolve('ai/test')).href);
const sdk = JSON.parse(await readFile(requireCore.resolve('ai/package.json'), 'utf8'));
const usage = { inputTokens: { total: 3, noCache: 3 }, outputTokens: { total: 5, text: 5 } };
const task = { runId: 'same-run', attemptId: 'same-attempt' };
const pressureBytes = 1800; // Retained material pressure, never a task/step-count limit.
let requests = 0;
let globalStep = 0;
let taskFinal = false;
let sdkEnds = 0;
let rawHistory = [];
let completedRounds = [];
const executed = new Set();
const intents = [];
const segments = [];
let checkpoint = [{ role: 'user', content: 'ORIGINAL_TASK' }];
const model = new MockLanguageModelV4({
  doStream: async ({ prompt }) => {
    const request = requests++;
    if (request > 0) assert.ok(JSON.stringify(prompt).includes(`EVIDENCE_${request - 1}`));
    intents.push({ ...task, stepNumber: globalStep, effectId: `model-effect-${globalStep}` });
    const done = request === 24;
    const chunks = done
      ? [{ type: 'text-start', id: 'final' }, { type: 'text-delta', id: 'final', delta: 'FINISHED' }, { type: 'text-end', id: 'final' }]
      : [{ type: 'tool-call', toolCallId: `call-${request}`, toolName: 'read_evidence', input: JSON.stringify({ number: request }) }];
    chunks.push({ type: 'finish', finishReason: { unified: done ? 'stop' : 'tool-calls' }, usage });
    return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
  },
});

while (!taskFinal) {
  const baseStep = globalStep;
  let pendingRollover = false;
  let retainedBytes = 0;
  let latestPrepared = checkpoint;
  const segment = { ...task, baseStep, responseBytes: 0, completedSteps: 0, rolledOver: false };
  const agent = new ToolLoopAgent({
    model,
    stopWhen: [isLoopFinished(), () => pendingRollover],
    tools: {
      read_evidence: tool({
        inputSchema: jsonSchema({ type: 'object', properties: { number: { type: 'integer' } }, required: ['number'], additionalProperties: false }),
        execute: ({ number }) => {
          assert.ok(!executed.has(number), 'completed tool must not replay');
          executed.add(number);
          return { text: `EVIDENCE_${number}`, internalReceipt: 'RAW_PRIVATE_RECEIPT' };
        },
        toModelOutput: ({ output }) => ({ type: 'json', value: { text: output.text } }),
      }),
    },
    prepareStep: ({ stepNumber, messages }) => {
      assert.equal(baseStep + stepNumber, globalStep);
      latestPrepared = messages;
      return {};
    },
    onStepEnd: (event) => {
      assert.equal(baseStep + event.stepNumber, globalStep);
      assert.equal(event.response.messages[0].role, 'assistant');
      rawHistory.push({ ...task, stepNumber: globalStep++, messages: event.response.messages, rawToolResults: event.toolResults });
      segment.completedSteps++;
      retainedBytes += Buffer.byteLength(JSON.stringify(event.response.messages));
      segment.responseBytes = retainedBytes;
      if (event.toolResults.length) {
        assert.equal(event.response.messages.length, 2);
        assert.equal(event.response.messages[1].role, 'tool');
        assert.equal(event.toolResults[0].output.internalReceipt, 'RAW_PRIVATE_RECEIPT');
        assert.ok(!JSON.stringify(event.response.messages).includes('RAW_PRIVATE_RECEIPT'));
        completedRounds.push(event.response.messages);
        // Real implementation must persist/CAS a checkpoint and recheck authority here.
        if (retainedBytes >= pressureBytes) {
          pendingRollover = true;
          checkpoint = [{ role: 'user', content: `COMPACTED_SUMMARY: earlier steps 0..${globalStep - 3}; exact private history retained.` }, ...completedRounds.slice(-2).flat()];
          segment.rolledOver = true;
        }
      } else {
        assert.equal(event.text, 'FINISHED');
        taskFinal = true;
      }
    },
    onEnd: () => { sdkEnds++; },
  });
  const result = await agent.stream({ messages: latestPrepared });
  for await (const part of result.stream) if (part.type === 'error') throw part.error;
  assert.equal((await result.steps).length, segment.completedSteps);
  if (!taskFinal) assert.ok(segment.rolledOver, 'SDK end alone is not task success');
  segments.push(segment);
}
assert.equal(requests, 25);
assert.equal(executed.size, 24);
assert.equal(rawHistory.length, 25);
assert.ok(segments.length > 1);
assert.equal(sdkEnds, segments.length);
assert.deepEqual(intents.map((entry) => entry.stepNumber), Array.from({ length: 25 }, (_, index) => index));
assert.equal(new Set(intents.map((entry) => entry.effectId)).size, 25);
assert.ok(intents.every((entry) => entry.runId === task.runId && entry.attemptId === task.attemptId));
const output = { timestamp: new Date().toISOString(), node: process.version, sdkVersion: sdk.version,
  scope: 'Mock SDK pressure rollover only. Run/Attempt/Effect IDs and checkpoints are assertions, not production ledger verification.',
  pressureBytes, requests, executedTools: executed.size, globalSteps: globalStep, sdkEnds,
  taskFinal, segments, intents, maxSegmentSteps: Math.max(...segments.map((entry) => entry.completedSteps)), allAssertionsPassed: true };
await writeFile(new URL('./worker-sdk-probe-rollover-result.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ sdkVersion: sdk.version, requests, executedTools: executed.size, sdkEnds,
  maxSegmentSteps: output.maxSegmentSteps, allAssertionsPassed: true }));
