// Isolated policy comparison. Candidate source is loaded only by this process;
// the working ChatAgent, installed graph, and original tests are never modified.
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, '../../../../..');
const mode = process.argv[2];
assert(['baseline', 'target', 'candidate'].includes(mode), 'Choose baseline, target, or candidate');
const coreRequire = createRequire(resolve(root, 'packages/core/package.json'));
const oldRequire = createRequire(resolve(evidence, 'abort-baseline/package.json'));
const targetAiRequire = createRequire(coreRequire.resolve('ai'));
const pinnedNames = ['ai', '@ai-sdk/openai-compatible', '@ai-sdk/provider', '@ai-sdk/provider-utils', '@ai-sdk/gateway'];
const pinnedEntries = Object.fromEntries(pinnedNames.map(name => [name,
  mode === 'baseline' ? oldRequire.resolve(name) :
    (name === 'ai' || name === '@ai-sdk/openai-compatible' ? coreRequire : targetAiRequire).resolve(name)]));
const targetUtilsRequire = createRequire(targetAiRequire.resolve('@ai-sdk/provider-utils'));
const targetGatewayRequire = createRequire(targetAiRequire.resolve('@ai-sdk/gateway'));
const fallbackEntries = Object.fromEntries(['@taki/shared', 'zod', 'zod/v3', 'zod/v4']
  .map(name => [name, coreRequire.resolve(name)]));
for (const name of ['@workflow/serde', 'eventsource-parser', 'eventsource-parser/stream']) {
  fallbackEntries[name] = targetUtilsRequire.resolve(name);
}
fallbackEntries['@vercel/oidc'] = targetGatewayRequire.resolve('@vercel/oidc');
const productionChat = pathToFileURL(resolve(root, 'packages/core/src/agents/chat-agent.ts')).href;
const selectedChat = mode === 'baseline'
  ? pathToFileURL(resolve(evidence, '../baseline/preimages/packages/core/src/agents/chat-agent.ts')).href
  : mode === 'candidate' ? pathToFileURL(resolve(evidence, 'cancel-policy-candidate/chat-agent.ts')).href : productionChat;
registerHooks({ resolve(specifier, context, nextResolve) {
  const pinned = pinnedEntries[specifier] ?? fallbackEntries[specifier];
  if (pinned) return nextResolve(pathToFileURL(pinned).href, context);
  if (context.parentURL === selectedChat && selectedChat !== productionChat && specifier.startsWith('.')) {
    return nextResolve(new URL(specifier, productionChat).href, context);
  }
  return nextResolve(specifier, context);
} });

const { createChatAgent } = await import(selectedChat);
const { APICallError, simulateReadableStream } = await import('ai');
const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
const { openDatabase } = await import(pathToFileURL(resolve(root, 'packages/core/src/db/sqlite.ts')).href);
const { MIGRATIONS } = await import(pathToFileURL(resolve(root, 'packages/core/src/db/migrations/index-list.ts')).href);
const { createTimelineRepo } = await import(pathToFileURL(resolve(root, 'packages/core/src/db/timeline-repo.ts')).href);
const { createConversationStore } = await import(pathToFileURL(resolve(root, 'packages/core/src/agents/conversation-store.ts')).href);

function sse(text, finishReason = null) {
  return 'data: ' + JSON.stringify({ id: 'policy-fixture', object: 'chat.completion.chunk', created: 0,
    model: 'fixture', choices: [{ index: 0, delta: { content: text }, finish_reason: finishReason }],
    ...(finishReason ? { usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } } : {}),
  }) + '\n\n';
}

function gracefulModel(counts) {
  return {
    specificationVersion: 'v4', provider: 'resolving-fixture', modelId: 'fixture', supportedUrls: {},
    async doGenerate() { throw new Error('Unexpected generate call'); },
    async doStream() {
      counts.modelRequests += 1;
      return { stream: simulateReadableStream({ chunkDelayInMs: 5, chunks: [
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'partial' },
        { type: 'text-delta', id: 'text', delta: 'unread' },
        { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 3 }, outputTokens: { total: 5 } } },
      ] }) };
    },
  };
}

async function probe(stage) {
  const abort = new AbortController();
  const counts = { modelRequests: 0, maintenance: 0, usage: 0, primaryCommits: 0, retractions: 0 };
  const server = createServer((request, response) => {
    counts.modelRequests += 1;
    request.resume();
    request.on('end', () => {
      if (stage === 'provider-error') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Fixture provider refusal' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      if (stage === 'prefill') {
        // Input timing selects the no-delta cancellation case; no repair depends on this delay.
        setTimeout(() => abort.abort('turn cancelled by operator'), 40);
      } else if (stage === 'success') {
        response.end(sse('complete', 'stop') + 'data: [DONE]\n\n');
      } else response.write(sse('partial'));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const db = openDatabase({ path: ':memory:', migrations: MIGRATIONS });
  const store = createConversationStore({ repo: createTimelineRepo(db) });
  let text = '';
  let caught;
  let timeout;
  const started = performance.now();
  try {
    const provider = createOpenAICompatible({ name: 'local-policy-fixture', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const agent = createChatAgent({ model: stage === 'graceful-fake' ? gracefulModel(counts) : provider('fixture'), store,
      memory: { assemble: () => '', createTools: () => ({}) },
      autoMemory: { onTurnCompleted: () => { counts.maintenance += 1; } },
      onUsage: () => { counts.usage += 1; },
      onPrimaryCommitted: () => { counts.primaryCommits += 1; },
    });
    try {
      await Promise.race([
        (async () => {
          for await (const delta of agent.stream({ characterId: 'taki', message: 'Fixture only' }, {
            signal: abort.signal, onRetract: () => { counts.retractions += 1; },
          })) {
            text += delta;
            if (stage === 'partial' || stage === 'graceful-fake') abort.abort('turn cancelled by operator');
          }
        })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('probe timeout')), 3000); timeout.unref(); }),
      ]);
    } catch (error) { caught = error; }
    // Flush already scheduled detached callbacks for observation only; no production code waits here.
    await new Promise(resolve => setImmediate(resolve));
    return { stage, text, aborted: abort.signal.aborted, counts, history: store.history('taki'),
      failure: caught === undefined ? null : { isAbortReason: caught === abort.signal.reason,
        isApiCallError: APICallError.isInstance(caught), statusCode: caught?.statusCode ?? null,
        type: typeof caught, name: caught?.name ?? null,
        message: typeof caught === 'string' ? caught : caught?.message ?? null },
      durationMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

const results = [];
for (const stage of ['prefill', 'partial', 'graceful-fake', 'success', 'provider-error']) results.push(await probe(stage));
const versions = Object.fromEntries(pinnedNames.map(name => [name,
  JSON.parse(readFileSync(resolve(dirname(pinnedEntries[name]), '../package.json'), 'utf8')).version]));
const result = { mode, node: process.version, source: selectedChat, packages: versions,
  transport: 'real Node fetch and local HTTP SSE, except explicitly labelled resolving fake',
  storage: 'actual in-memory SQLite and ConversationStore', credentials: 'none', results };
writeFileSync(resolve(evidence, `cancel-policy-${mode}.json`), JSON.stringify(result, null, 2) + '\n');

// The expectations are the explicit proposed behavior matrix, including its two compatibility changes.
for (const observed of results) {
  const { stage, counts, failure, history } = observed;
  assert.equal(counts.modelRequests, 1, stage);
  if (stage === 'prefill') {
    assert.deepEqual(history, []); assert.equal(counts.retractions, 1); assert.equal(counts.primaryCommits, 0);
    assert.equal(counts.maintenance, 0); assert.equal(failure, null);
  } else if (stage === 'partial' || stage === 'graceful-fake') {
    assert.deepEqual(history, [{ role: 'user', content: 'Fixture only' }, { role: 'assistant', content: 'partial' }]);
    assert.equal(counts.primaryCommits, 1); assert.equal(counts.retractions, 0);
    assert.equal(counts.maintenance, mode === 'candidate' || (mode === 'baseline' && stage === 'partial') ? 0 : 1);
    if (mode === 'baseline' && stage === 'partial') assert.equal(failure?.isAbortReason, true);
    else assert.equal(failure, null);
  } else if (stage === 'success') {
    assert.equal(observed.text, 'complete'); assert.equal(counts.maintenance, 1);
    assert.equal(counts.primaryCommits, 1); assert.equal(failure, null);
  } else {
    assert.equal(counts.maintenance, 0); assert.equal(counts.primaryCommits, 1);
    assert.equal(failure?.isApiCallError, true); assert.equal(failure?.statusCode, 401);
    assert.deepEqual(history, [{ role: 'user', content: 'Fixture only' }]);
  }
}
console.log(JSON.stringify({ mode, assertions: 'passed', results }, null, 2));
