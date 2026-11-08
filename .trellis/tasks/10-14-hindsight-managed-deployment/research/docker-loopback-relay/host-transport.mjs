/** Exclusive loopback listener, two fixed exec streams, and the two generated binary clients. */
import { createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const LIMIT = 65536;
const errorCode = (error) => 'code' in error ? error.code : error.name;

export function challenge(token, label, size) {
  const pieces = [];
  for (let i = 0; i < Math.ceil(size / 32); i++) pieces.push(createHash('sha256').update(`${token}:${label}:${i}`).digest());
  return Buffer.concat(pieces).subarray(0, size);
}

export function bounded(promise, deadline, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), Math.max(1, deadline - performance.now()));
    promise.then((value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
}

export class JsonEvents {
  constructor(schema) {
    this.schema = schema;
    this.events = [];
    this.pending = '';
    this.waiters = new Set();
    this.error = null;
  }

  push(chunk) {
    this.pending += chunk.toString('utf8');
    if (this.pending.length > 32768) { this.error = 'EVENT_BOUND'; return; }
    while (this.pending.includes('\n')) {
      const split = this.pending.indexOf('\n');
      const line = this.pending.slice(0, split);
      this.pending = this.pending.slice(split + 1);
      try {
        const event = JSON.parse(line);
        if (event.schema !== this.schema || typeof event.event !== 'string' || this.events.length >= 24) throw new Error('EVENT_SHAPE');
        this.events.push(event);
      } catch { this.error = 'EVENT_PROTOCOL'; }
      for (const wake of [...this.waiters]) wake();
    }
  }

  async wait(name, deadline, command) {
    let wake;
    const arrived = new Promise((resolve, reject) => {
      wake = () => {
        if (this.error) reject(new Error(this.error));
        const found = this.events.find((event) => event.event === name);
        if (found) resolve(found);
      };
      this.waiters.add(wake);
      wake();
    });
    try {
      return await bounded(Promise.race([arrived, command.done.then(() => {
        throw new Error(`PROCESS_CLOSED_BEFORE_${name}`);
      })]), deadline, `EVENT_DEADLINE_${name}`);
    } finally { this.waiters.delete(wake); }
  }
}

export class HostTransport {
  constructor(settings) {
    this.settings = settings;
    this.ready = false;
    this.closed = false;
    this.accepted = 0;
    this.streams = [];
    this.sockets = new Set();
    this.failures = [];
    this.server = createServer({ allowHalfOpen: true }, (socket) => this.accept(socket));
    this.server.on('error', (error) => this.failures.push(errorCode(error)));
  }

  async listen() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen({ host: '127.0.0.1', port: 58118, exclusive: true }, () => {
        this.server.removeListener('error', reject);
        resolve(undefined);
      });
    });
    return this.server.address();
  }

  accept(socket) {
    this.accepted++;
    // Attach a handler before any refusal/early destroy; accepted streams record their own errors below.
    socket.on('error', (error) => { if (!this.ready) this.failures.push(`unready:${error.code ?? error.name}`); });
    if (!this.ready || this.closed || this.accepted > 2) {
      this.failures.push('UNEXPECTED_CONNECTION'); socket.destroy(); return;
    }
    this.sockets.add(socket);
    const events = new JsonEvents('c2b-stream-relay-v1');
    let command;
    try { command = this.settings.startRelay((chunk) => events.push(chunk)); }
    catch (error) { this.failures.push(error.message); socket.destroy(); this.sockets.delete(socket); return; }
    let markClosed;
    const closed = new Promise((resolve) => { markClosed = resolve; });
    const stream = { index: this.accepted, events, command, closed, toChild: 0, toClient: 0,
      clientEnd: false, clientClosed: false, aborted: false, errors: [], backpressure: { toChild: 0, toClient: 0 } };
    this.streams.push(stream);
    const inputHash = createHash('sha256');
    socket.setNoDelay(true);
    socket.setTimeout(12_000, () => { stream.errors.push('CLIENT_TIMEOUT'); socket.destroy(); });
    socket.on('data', (chunk) => {
      stream.toChild += chunk.length;
      if (stream.toChild > LIMIT) { stream.errors.push('INPUT_BOUND'); socket.destroy(); return; }
      inputHash.update(chunk);
      command.record.stdinBytes = stream.toChild;
      command.record.stdinSha256 = inputHash.copy().digest('hex');
      if (!command.child.stdin.write(chunk)) { stream.backpressure.toChild++; socket.pause(); }
    });
    command.child.stdin.on('drain', () => { if (!socket.destroyed) socket.resume(); });
    command.child.stdin.on('error', (error) => {
      stream.errors.push(`stdin:${error.code ?? error.name}`); socket.destroy();
    });
    socket.on('end', () => { stream.clientEnd = true; command.child.stdin.end(); });
    command.child.stdout.on('data', (chunk) => {
      stream.toClient += chunk.length;
      if (stream.toClient > LIMIT) { stream.errors.push('OUTPUT_BOUND'); socket.destroy(); return; }
      if (!socket.destroyed && !socket.write(chunk)) { stream.backpressure.toClient++; command.child.stdout.pause(); }
    });
    socket.on('drain', () => command.child.stdout.resume());
    command.child.stdout.on('end', () => { if (!socket.destroyed) socket.end(); });
    socket.on('error', (error) => stream.errors.push(`client:${error.code ?? error.name}`));
    socket.on('close', () => {
      stream.clientClosed = true;
      markClosed();
      this.sockets.delete(socket);
      stream.aborted = !stream.clientEnd;
      command.child.stdout.resume();
      if (stream.aborted) {
        // Closing stdin propagates cancellation into the original exec's half-close path.
        command.child.stdin.end();
        const timer = setTimeout(() => command.terminate('client-abort'), 1000);
        command.done.then(() => clearTimeout(timer));
      }
    });
    command.done.then((record) => {
      if (!record.closeObserved || record.code !== 0) stream.errors.push('RELAY_CLI_UNSUCCESSFUL');
      if (!socket.destroyed) socket.end();
    });
  }

  async close() {
    this.ready = false; this.closed = true;
    const closed = new Promise((resolve) => {
      if (!this.server.listening) { resolve(undefined); return; }
      this.server.close(() => resolve(undefined));
    });
    for (const socket of this.sockets) socket.destroy();
    await closed;
  }
}

export async function binaryClient(settings) {
  const abort = settings.abort;
  const request = challenge(settings.token, abort ? 'abort-request' : 'request', abort ? 1024 : 32768);
  const expected = challenge(settings.token, abort ? 'abort-ack' : 'response', abort ? 512 : 49152);
  const chunks = [];
  const facts = { requestBytes: request.length, requestSha256: digest(request), writes: [], receivedBytes: 0,
    receivedSha256: null, connected: false, endObserved: false, closeObserved: false, abortIssued: false,
    requestHalfClosed: false, errors: [], valid: false };
  const socket = connect({ host: '127.0.0.1', port: 58118, allowHalfOpen: true });
  socket.setNoDelay(true);
  const closed = new Promise((resolve) => socket.once('close', () => { facts.closeObserved = true; resolve(undefined); }));
  socket.on('error', (error) => facts.errors.push(errorCode(error)));
  socket.setTimeout(10_000, () => { facts.errors.push('CLIENT_DEADLINE'); socket.destroy(); });
  socket.on('end', () => { facts.endObserved = true; socket.destroy(); });
  socket.on('data', (chunk) => {
    facts.receivedBytes += chunk.length;
    if (facts.receivedBytes > LIMIT || facts.receivedBytes > expected.length) {
      facts.errors.push('CLIENT_RESPONSE_BOUND'); socket.destroy(); return;
    }
    chunks.push(chunk);
    if (abort && facts.receivedBytes === expected.length) {
      facts.abortIssued = true;
      socket.resetAndDestroy();
    }
  });
  try {
    await bounded(new Promise((resolve, reject) => {
      socket.once('connect', () => { facts.connected = true; resolve(undefined); });
      socket.once('error', reject);
    }), settings.deadline, 'CLIENT_CONNECT_DEADLINE');
    let offset = 0;
    for (const size of [1, 7, 127, 1025, 4095, 8193, request.length]) {
      const piece = request.subarray(offset, offset + size);
      if (!piece.length) break;
      await bounded(new Promise((resolve, reject) => socket.write(piece, (error) => error ? reject(error) : resolve(undefined))),
        settings.deadline, 'CLIENT_WRITE_DEADLINE');
      facts.writes.push(piece.length); offset += piece.length;
    }
    if (!abort) { socket.end(); facts.requestHalfClosed = true; }
    await bounded(closed, settings.deadline, 'CLIENT_CLOSE_DEADLINE');
  } finally { socket.destroy(); }
  const response = Buffer.concat(chunks);
  facts.receivedSha256 = digest(response);
  facts.valid = facts.connected && facts.closeObserved && facts.errors.length === 0 && response.equals(expected)
    && (abort ? facts.abortIssued && !facts.requestHalfClosed : facts.requestHalfClosed && facts.endObserved);
  return facts;
}

export async function provePortFree() {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once('error', (error) => resolve({ free: false, error: errorCode(error) }));
    probe.listen({ host: '127.0.0.1', port: 58118, exclusive: true }, () => probe.close(() => resolve({ free: true })));
  });
}

export async function proveExclusiveListener() {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once('error', (error) => resolve({ refused: error.code === 'EADDRINUSE', code: errorCode(error) }));
    probe.listen({ host: '127.0.0.1', port: 58118, exclusive: true }, () => {
      probe.close(() => resolve({ refused: false, code: 'SECOND_BIND_SUCCEEDED' }));
    });
  });
}
