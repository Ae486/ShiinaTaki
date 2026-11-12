import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const requireCore = createRequire(resolve(root, 'packages/core/package.json'));
function metadata(requireFrom, name) {
  const path = requireFrom.resolve(`${name}/package.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const nested = createRequire(path);
  const dependencies = {};
  for (const dep of Object.keys(data.dependencies ?? {})) {
    try {
      const location = nested.resolve(`${dep}/package.json`);
      dependencies[dep] = { version: JSON.parse(readFileSync(location, 'utf8')).version, path: location };
    } catch {
      dependencies[dep] = { specifier: data.dependencies[dep], path: nested.resolve(dep) };
    }
  }
  return { version: data.version, path, engines: data.engines, peerDependencies: data.peerDependencies, dependencies };
}
const packages = Object.fromEntries(['ai', '@ai-sdk/mcp', '@ai-sdk/openai-compatible', 'zod', 'cross-spawn'].map(name => [name, metadata(requireCore, name)]));
const requireUtils = createRequire(packages.ai.dependencies['@ai-sdk/provider-utils'].path);
const result = { node: process.version, cwd: root, packages, nestedProviderUtils: metadata(requireUtils, '@ai-sdk/provider-utils') };
const target = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), process.argv[2], 'inventory.json');
writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
