// Deterministic SDK contract probe; no provider or production database access.
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
const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

async function exercise(unlimited) {
  let requests = 0;
  let executed = 0;
  const preparation = [];
  const completion = [];
  const compactedAt = [];
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const number = requests++;
      const done = number === 22;
      const chunks = done
        ? [
          { type: 'text-start', id: 'final' },
          { type: 'text-delta', id: 'final', delta: 'FINISHED' },
          { type: 'text-end', id: 'final' },
        ]
        : [{ type: 'tool-call', toolCallId: `call-${number}`, toolName: 'read_evidence', input: '{}' }];
      chunks.push({ type: 'finish', finishReason: { unified: done ? 'stop' : 'tool-calls', raw: undefined }, usage });
      return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
    },
  });
  const agent = new ToolLoopAgent({
    model,
    ...(unlimited ? { stopWhen: isLoopFinished() } : {}),
    tools: {
      read_evidence: tool({
        inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false, required: [] }),
        execute: async () => ({ text: `EVIDENCE_${executed++}`, privateReceipt: 'INTERNAL_RECEIPT' }),
        toModelOutput: ({ output }) => ({ type: 'json', value: { text: output.text } }),
      }),
    },
    prepareStep: async ({ stepNumber, messages, responseMessages }) => {
      preparation.push({
        stepNumber,
        messageCount: messages.length,
        rawResponseCount: responseMessages.length,
        hasSummary: JSON.stringify(messages).includes('COMPACTED_SUMMARY'),
        hasEarliestResultInRaw: JSON.stringify(responseMessages).includes('EVIDENCE_0'),
      });
      if (unlimited && stepNumber > 0 && stepNumber % 5 === 0) {
        compactedAt.push(stepNumber);
        return { messages: [{ role: 'user', content: 'COMPACTED_SUMMARY: older complete rounds retained in private history' }, ...messages.slice(-4)] };
      }
      return {};
    },
    onStepEnd: (event) => {
      completion.push({
        stepNumber: event.stepNumber,
        messageCount: event.response.messages.length,
        fullToolReceiptAvailable: event.toolResults.some((entry) => entry.output.privateReceipt === 'INTERNAL_RECEIPT'),
        receiptAbsentFromModelResponse: !JSON.stringify(event.response.messages).includes('INTERNAL_RECEIPT'),
      });
    },
  });
  const result = await agent.stream({ messages: [{ role: 'user', content: 'ORIGINAL_TASK' }] });
  for await (const part of result.stream) {
    if (part.type === 'error') throw part.error;
  }
  const steps = await result.steps;
  const responseMessages = await result.responseMessages;
  return {
    requests, executed, completedSteps: steps.length,
    fullResponseMessages: responseMessages.length,
    retainedEarliestResult: JSON.stringify(responseMessages).includes('EVIDENCE_0'),
    maxPreparedMessageCount: Math.max(...preparation.map((entry) => entry.messageCount)),
    compactedAt, preparation, completion,
  };
}

const standard = await exercise(false);
const unlimited = await exercise(true);
assert.equal(standard.requests, 20);
assert.equal(unlimited.requests, 23);
assert.equal(unlimited.executed, 22);
assert.equal(unlimited.completedSteps, 23);
assert.ok(unlimited.retainedEarliestResult);
assert.deepEqual(unlimited.compactedAt, [5, 10, 15, 20]);
assert.ok(unlimited.preparation[6].hasSummary);
assert.ok(unlimited.preparation[21].hasSummary);
assert.ok(unlimited.preparation[22].hasEarliestResultInRaw);
assert.ok(unlimited.maxPreparedMessageCount <= 15);
assert.ok(unlimited.completion.slice(0, -1).every((entry) => entry.messageCount === 2));
assert.ok(unlimited.completion.slice(0, -1).every((entry) => entry.fullToolReceiptAvailable && entry.receiptAbsentFromModelResponse));
const output = {
  timestamp: new Date().toISOString(), node: process.version, sdkVersion: sdk.version,
  scope: 'Installed SDK only; deterministic MockLanguageModelV4, no provider requests or production database.',
  standard, unlimited,
};
await writeFile(new URL('./worker-sdk-probe-result.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ sdkVersion: sdk.version, defaultRequests: standard.requests, unlimitedRequests: unlimited.requests,
  compactedAt: unlimited.compactedAt, maxPreparedMessageCount: unlimited.maxPreparedMessageCount,
  fullRetainedResponseMessages: unlimited.fullResponseMessages, allAssertionsPassed: true }));
