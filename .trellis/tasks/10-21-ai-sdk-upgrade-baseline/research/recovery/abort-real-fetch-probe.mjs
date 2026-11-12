// Deterministic transport probe: original ChatAgent preimage or current ChatAgent, real Node fetch,
// actual compatible adapter, actual in-memory ConversationStore, and counted detached-write sinks.
import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, '../../../../..');
const mode = process.argv[2];
if (!['baseline', 'target'].includes(mode)) throw new Error('Choose baseline or target');
const evidenceSuffix = process.argv[3] ?? '';
if (!/^[a-z0-9-]*$/.test(evidenceSuffix)) throw new Error('Invalid evidence suffix');
const coreRequire = createRequire(resolve(root, 'packages/core/package.json'));
const cacheRequire = createRequire(resolve(evidence, 'abort-baseline/package.json'));
const pinned = new Set(['ai', '@ai-sdk/openai-compatible', '@ai-sdk/provider', '@ai-sdk/provider-utils', '@ai-sdk/gateway']);
const targetAiRequire = createRequire(coreRequire.resolve('ai'));
const pinnedEntries = Object.fromEntries([...pinned].map(name => [name,
  mode === 'baseline' ? cacheRequire.resolve(name) : (name === 'ai' || name === '@ai-sdk/openai-compatible'
    ? coreRequire.resolve(name) : targetAiRequire.resolve(name))]));
const fallbackParents = {
  '@vercel/oidc': createRequire(coreRequire.resolve('ai')),
  '@workflow/serde': createRequire(createRequire(coreRequire.resolve('ai')).resolve('@ai-sdk/provider-utils')),
  'eventsource-parser': createRequire(createRequire(coreRequire.resolve('ai')).resolve('@ai-sdk/provider-utils')),
};
// Other dependencies are unchanged in the captured lock; resolve them from their real target parents.
fallbackParents['@vercel/oidc'] = createRequire(fallbackParents['@vercel/oidc'].resolve('@ai-sdk/gateway'));
const fallbackEntries = Object.fromEntries(['@taki/shared', 'zod', ...Object.keys(fallbackParents)]
  .map(name => [name, (fallbackParents[name] ?? coreRequire).resolve(name)]));
for (const name of ['zod/v3', 'zod/v4']) fallbackEntries[name] = coreRequire.resolve(name);
fallbackEntries['eventsource-parser/stream'] = fallbackParents['eventsource-parser'].resolve('eventsource-parser/stream');
const originalChat = pathToFileURL(resolve(root, 'packages/core/src/agents/chat-agent.ts')).href;
const baselineChat = pathToFileURL(resolve(evidence, '../baseline/preimages/packages/core/src/agents/chat-agent.ts')).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (pinned.has(specifier)) {
    return nextResolve(pathToFileURL(pinnedEntries[specifier]).href, context);
  }
  if (fallbackEntries[specifier]) {
    return nextResolve(pathToFileURL(fallbackEntries[specifier]).href, context);
  }
  if (context.parentURL === baselineChat && specifier.startsWith('.')) {
    return nextResolve(new URL(specifier, originalChat).href, context);
  }
  return nextResolve(specifier, context);
} });

const { createChatAgent } = await import(mode === 'baseline' ? baselineChat : originalChat);
const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
const { openDatabase } = await import(pathToFileURL(resolve(root, 'packages/core/src/db/sqlite.ts')).href);
const { MIGRATIONS } = await import(pathToFileURL(resolve(root, 'packages/core/src/db/migrations/index-list.ts')).href);
const { createTimelineRepo } = await import(pathToFileURL(resolve(root, 'packages/core/src/db/timeline-repo.ts')).href);
const { createConversationStore } = await import(pathToFileURL(resolve(root, 'packages/core/src/agents/conversation-store.ts')).href);

async function probe(stage) {
  const abort = new AbortController();
  const counts = { modelRequests: 0, maintenance: 0, usage: 0, primaryCommits: 0, retractions: 0 };
  const server = createServer((request, response) => {
    counts.modelRequests += 1;
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      if (stage === 'prefill') setTimeout(() => abort.abort('turn cancelled by operator'), 40);
      else response.write('data: ' + JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 0,
        model: 'fixture', choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }) + '\n\n');
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const db = openDatabase({ path: ':memory:', migrations: MIGRATIONS });
  const store = createConversationStore({ repo: createTimelineRepo(db) });
  let caught;
  let text = '';
  try {
    const provider = createOpenAICompatible({ name: 'local-probe', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const agent = createChatAgent({ model: provider('fixture'), store,
      memory: { assemble: () => '', createTools: () => ({}) },
      autoMemory: { onTurnCompleted: () => { counts.maintenance += 1; } },
      onUsage: () => { counts.usage += 1; },
      onPrimaryCommitted: () => { counts.primaryCommits += 1; },
    });
    const started = performance.now();
    try {
      await Promise.race([
        (async () => {
          if (stage === 'raw-provider') {
            const result = await provider('fixture').doStream({
              prompt: [{ role: 'user', content: [{ type: 'text', text: 'Fixture only' }] }], abortSignal: abort.signal,
            });
            for await (const part of result.stream) if (part.type === 'text-delta') {
              text += part.delta; abort.abort('turn cancelled by operator');
            }
            return;
          }
          for await (const delta of agent.stream({ characterId: 'taki', message: 'Fixture only' }, {
            signal: abort.signal, onRetract: () => { counts.retractions += 1; },
          })) { text += delta; abort.abort('turn cancelled by operator'); }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 3000).unref()),
      ]);
    } catch (error) { caught = error; }
    await new Promise(resolve => setTimeout(resolve, 40));
    return { stage, text, counts, history: store.history('taki'),
      failure: caught === undefined ? null : { isAbortReason: caught === abort.signal.reason, type: typeof caught,
        name: caught?.name ?? null, message: typeof caught === 'string' ? caught : caught?.message ?? null,
        causeIsAbortReason: caught?.cause === abort.signal.reason,
        causeName: caught?.cause?.name ?? null, causeMessage: caught?.cause?.message ?? null },
      durationMs: Math.round(performance.now() - started) };
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
  }
}
const versions = {};
for (const name of pinned) {
  const entry = pinnedEntries[name];
  const manifest = JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'), 'utf8'));
  versions[name] = { version: manifest.version, entry };
}
const result = { mode, node: process.version, globalFetch: true, storage: 'actual in-memory SQLite and ConversationStore',
  credentials: 'none', packages: versions, results: [await probe('prefill'), await probe('partial'), await probe('raw-provider')] };
writeFileSync(resolve(evidence, `abort-real-fetch-${mode}${evidenceSuffix ? `-${evidenceSuffix}` : ''}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
