/** Parse and lint frozen source text only; never import or evaluate a packet module. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import eslintConfig from '@eslint/js';
import { ESLint } from 'eslint';

const here = dirname(fileURLToPath(import.meta.url));
const before = process.argv[2] === 'before';
if (process.argv.length !== 3 || !['before', 'after'].includes(process.argv[2])) throw new Error('CHECK_MODE');
const packet = before ? join(here, 'released-before-review') : resolve(here, '../docker-dependency-inventory');
const files = ['launch.mjs', 'docker-commands.mjs', 'evidence-store.mjs'];
const lint = new ESLint({
  overrideConfigFile: true,
  ignore: false,
  overrideConfig: [{
    ...eslintConfig.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      globals: Object.fromEntries(['Buffer', 'URL', 'process', 'console', 'setTimeout', 'clearTimeout'].map((name) => [name, 'readonly'])),
    },
  }],
});
const records = [];
for (const name of files) {
  const path = join(packet, name);
  const bytes = readFileSync(path);
  const syntax = spawnSync('C:/Program Files/nodejs/node.exe', ['--check', path], {
    encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false,
    env: { SystemRoot: process.env.SystemRoot },
  });
  const [result] = await lint.lintText(bytes.toString('utf8'), { filePath: name });
  records.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'),
    syntax: { code: syntax.status, stdout: syntax.stdout, stderr: syntax.stderr, error: syntax.error?.code ?? null },
    lint: { errors: result.errorCount, warnings: result.warningCount, messages: result.messages } });
}
const pass = records.every((item) => item.syntax.code === 0 && !item.syntax.error && item.lint.errors === 0 && item.lint.warnings === 0);
const evidence = { mode: before ? 'before' : 'after', runtimeExecuted: false, packetModulesEvaluated: false,
  node: process.version, eslint: ESLint.version, ruleSet: '@eslint/js recommended with Node globals; isolated task diagnostic', pass, records };
writeFileSync(join(here, `${before ? 'before' : 'after'}-javascript.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = pass ? 0 : 1;
