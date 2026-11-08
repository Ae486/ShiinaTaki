// Diagnostic only: compare saved source with current code without editing the checkout.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const path = process.env.TAKI_REENTRY_SOURCE_PREIMAGE;
if (!path) throw new Error('TAKI_REENTRY_SOURCE_PREIMAGE is required');
const sources = JSON.parse(readFileSync(path, 'utf8'));
const loaded = new Set();
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!Object.hasOwn(sources, url)) return result;
    loaded.add(url);
    return { ...result, source: sources[url] };
  },
});
process.on('exit', () => {
  if (loaded.size !== Object.keys(sources).length) {
    console.error('Incomplete diagnostic source replacement', [...loaded]);
    process.exitCode = 1;
  }
});
