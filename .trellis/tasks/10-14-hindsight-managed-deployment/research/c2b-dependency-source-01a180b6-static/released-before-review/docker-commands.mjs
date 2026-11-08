/** Fixed Docker child ownership and bounded command evidence; no ambient CLI configuration. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const errorCode = (error) => 'code' in error ? error.code : error.name;

export class DockerCommands {
  constructor(settings) {
    this.settings = settings;
    this.records = [];
    this.active = new Set();
    this.deadline = settings.runtimeDeadline;
    this.phase = 'runtime';
  }

  cleanupDeadline(deadline) {
    this.phase = 'cleanup';
    this.deadline = deadline;
    for (const command of this.active) command.rearm();
  }

  start(args, options = {}) {
    if (this.records.length >= 48) throw new Error('COMMAND_BOUND');
    if (digest(readFileSync(this.settings.docker)) !== this.settings.dockerSha256) throw new Error('DOCKER_PIN_CHANGED');
    if (readdirSync(this.settings.config).length !== 0) throw new Error('CLIENT_CONFIG_CHANGED');
    if (this.deadline - performance.now() < 1100) throw new Error('COMMAND_DEADLINE');
    const argv = ['--host', this.settings.endpoint, '--config', this.settings.config, ...args];
    const record = {
      index: this.records.length, phase: this.phase, argv: [this.settings.docker, ...argv],
      dispatchedAt: new Date().toISOString(), stdinSha256: options.input ? digest(options.input) : null,
      stdinBytes: options.input?.length ?? null, stdout: '', stderr: '', code: null, signal: null,
      childPid: null,
      closeObserved: false, timedOut: false, overflow: false, spawnError: null, persistenceError: null, streamErrors: [], kills: [],
      stdoutBytes: 0, stderrBytes: 0, stdoutSha256: null, stderrSha256: null,
    };
    this.records.push(record);
    this.settings.persist(this.records); // Dispatch is durable before the external call.
    const child = spawn(this.settings.docker, argv, {
      cwd: this.settings.stage, env: { SystemRoot: this.settings.systemRoot },
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    record.childPid = child.pid ?? null;
    const stdout = [];
    const stderr = [];
    let finished = false;
    let terminating = false;
    let timer;
    let killTimer;
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    const finish = (code, signal, closeObserved) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      Object.assign(record, {
        code, signal, closeObserved, stdout: options.binary ? out.toString('base64') : out.toString('utf8'),
        stdoutEncoding: options.binary ? 'base64' : 'utf8', stderr: err.toString('utf8'),
        stdoutSha256: digest(out), stderrSha256: digest(err), completedAt: new Date().toISOString(),
      });
      this.active.delete(handle);
      try { this.settings.persist(this.records); }
      catch (error) { record.persistenceError = error.code ?? error.name; }
      settle(record);
    };
    const terminate = (reason) => {
      if (finished || terminating) return;
      terminating = true;
      killTimer = setTimeout(() => {
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(null, null, false);
      }, 900);
      record.kills.push({ reason, accepted: child.kill(), at: new Date().toISOString() });
    };
    const rearm = () => {
      clearTimeout(timer);
      const limit = Math.min(options.timeout ?? 60_000, this.deadline - performance.now() - 1000);
      timer = setTimeout(() => { record.timedOut = true; terminate('deadline'); }, Math.max(1, limit));
    };
    const capture = (name, chunks, maximum, chunk) => {
      record[`${name}Bytes`] += chunk.length;
      if (record[`${name}Bytes`] > maximum) {
        record.overflow = true;
        terminate(`${name}-bound`);
        return;
      }
      chunks.push(chunk);
      if (name === 'stdout') options.onStdout?.(chunk);
      else options.onStderr?.(chunk);
    };
    child.stdout.on('data', (chunk) => capture('stdout', stdout, options.maxStdout ?? 32768, chunk));
    child.stderr.on('data', (chunk) => capture('stderr', stderr, 16384, chunk));
    for (const [name, stream] of Object.entries({ stdin: child.stdin, stdout: child.stdout, stderr: child.stderr })) {
      stream.on('error', (error) => record.streamErrors.push({ stream: name, code: errorCode(error) }));
    }
    child.on('error', (error) => { record.spawnError = errorCode(error); terminate('child-error'); });
    child.on('close', (code, signal) => finish(code, signal, true));
    const handle = { child, record, done, terminate, rearm };
    this.active.add(handle);
    rearm();
    if (!options.streaming) child.stdin.end(options.input);
    return handle;
  }

  async call(args, options = {}) {
    return this.start(args, options).done;
  }

  async stopRemaining() {
    const pending = [...this.active];
    for (const command of pending) command.terminate('final-owned-cli-cleanup');
    await Promise.all(pending.map((command) => command.done));
    return this.records.every((record) => record.closeObserved);
  }
}

export function commandOk(record) {
  return record.code === 0 && record.closeObserved && !record.spawnError && !record.persistenceError
    && record.streamErrors.length === 0 && !record.timedOut && !record.overflow;
}
