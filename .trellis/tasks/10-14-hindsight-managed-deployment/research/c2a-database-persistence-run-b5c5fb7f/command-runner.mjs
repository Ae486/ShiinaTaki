import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, statfsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
export const STAGE = 'G:/TakiAgent-c2a-database/persistence-b5c5fb7f-cd8a-402a-bd11-92839d191e98';
export const DOCKER = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
export const ENDPOINT = 'npipe:////./pipe/dockerDesktopLinuxEngine';
export const TOKEN = 'b5c5fb7f-cd8a-402a-bd11-92839d191e98';
export function assertFact(value, label) { if (!value) throw new Error(label); }
export function free(path) { const stat = statfsSync(path); return stat.bavail * stat.bsize; }
export function capacity() {
  const before = JSON.parse(readFileSync(STAGE + '/baseline.json', 'utf8'));
  assertFact(free('G:/') >= 20 * 1024 ** 3 && before.gFree - free('G:/') <= 2 * 1024 ** 3, 'G_CAPACITY');
  assertFact(free('C:/') >= 1024 ** 3, 'C_CAPACITY');
  assertFact(Date.now() - Date.parse(before.recordedAt) < 30 * 60_000, 'TOTAL_TIME_LIMIT');
}
export async function run(program, args, { timeout = 15000, input, env, allowFailure = false, cleanup = false } = {}) {
  assertFact(realpathSync(STAGE).toLowerCase() === resolve(STAGE).toLowerCase() && readFileSync(STAGE + '/.c2a-docker-owner', 'utf8') === TOKEN, 'OWNERSHIP');
  if (!cleanup) capacity();
  const childEnv = env ?? { SystemRoot: process.env.SystemRoot, TEMP: STAGE, TMP: STAGE };
  const record = { startedAt: new Date().toISOString(), program, args, environmentKeys: Object.keys(childEnv), timeoutMs: timeout, stdout: '', stderr: '', failure: null };
  const started = Date.now();
  const result = await new Promise((resolveResult) => {
    const child = spawn(program, args, { cwd: STAGE, env: childEnv, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'] });
    let count = 0;
    const timer = setTimeout(() => { record.failure = 'TIMEOUT'; child.kill(); }, timeout);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', (bytes) => {
      count += bytes.length;
      if (count <= 1024 * 1024) record[key] += bytes.toString('utf8');
      else { record.failure = 'OUTPUT_LIMIT'; child.kill(); }
    });
    child.on('error', (error) => { record.failure = error.code ?? error.name; });
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => { clearTimeout(timer); Object.assign(record, { exitCode: code, signal, elapsedMs: Date.now() - started }); resolveResult(record); });
    child.stdin.end(input);
  });
  appendFileSync(STAGE + '/commands.jsonl', JSON.stringify(result) + '\n');
  if (!allowFailure && (result.exitCode !== 0 || result.failure)) throw new Error('COMMAND_FAILED:' + result.failure + ':' + args.join(' '));
  if (!cleanup) capacity();
  return result;
}
export function docker(args, options = {}) {
  const { buildConfig = false, ...rest } = options;
  return run(DOCKER, ['--host', ENDPOINT, '--config', STAGE + (buildConfig ? '/build-config' : '/client-config'), ...args], rest);
}
