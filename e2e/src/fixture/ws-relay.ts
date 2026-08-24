/**
 * INPUT:  an upstream Core WS URL plus armable capability request/response frame transformers
 * OUTPUT: a loopback-only test relay with frame observation, forced Node disconnect, and bounded shutdown
 * POS:    e2e/fixture — test-only Core-to-Node fault injection; never imported by production transport
 */
import { once } from "node:events";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  CapabilityRequestSchema,
  CapabilityExecuteSchema,
  CapabilityRespondParamsSchema,
  type CapabilityRequest,
  type CapabilityExecute,
  type CapabilityRespondParams,
} from "@taki/shared";
import { getFreePort } from "./procs.ts";

export type CapabilityRequestMutator = (
  request: CapabilityRequest,
) => CapabilityRequest;
export type CapabilityResponseMutator = (
  response: CapabilityRespondParams,
) => CapabilityRespondParams;

export interface CapabilityRelay {
  url: string;
  requestCount(): number;
  responseCount(): number;
  activeConnectionCount(): number;
  mutateNext(mutator: CapabilityRequestMutator): void;
  mutateNextResponse(mutator: CapabilityResponseMutator): void;
  waitForRequestCount(count: number, timeoutMs?: number): Promise<void>;
  waitForResponseCount(count: number, timeoutMs?: number): Promise<void>;
  /** Holds the next explicit execute frame until the caller releases it. */
  pauseNextExecute(timeoutMs?: number): Promise<{ execute: CapabilityExecute; release(): void }>;
  close(): Promise<void>;
  isClosed(): boolean;
}

interface RelayPair {
  downstream: WebSocket;
  upstream: WebSocket;
  queued: string[];
}

interface RelayState {
  pairs: Set<RelayPair>;
  requestWaiters: Set<{ count: number; settle: () => void }>;
  responseWaiters: Set<{ count: number; settle: () => void }>;
  requests: number;
  responses: number;
  closed: boolean;
  nextRequestMutator?: CapabilityRequestMutator;
  nextResponseMutator?: CapabilityResponseMutator;
  nextExecutePause?: { resolve: (value: { execute: CapabilityExecute; release(): void }) => void; timer: ReturnType<typeof setTimeout> };
}

export async function startCapabilityRelay(upstreamUrl: string): Promise<CapabilityRelay> {
  const port = await getFreePort();
  const server = new WebSocketServer({ host: "127.0.0.1", port });
  const state: RelayState = {
    pairs: new Set(),
    requestWaiters: new Set(),
    responseWaiters: new Set(),
    requests: 0,
    responses: 0,
    closed: false,
  };

  server.on("connection", (downstream) => connectPair(state, upstreamUrl, downstream));
  await once(server, "listening");

  const relay: CapabilityRelay = {
    url: `ws://127.0.0.1:${port}`,
    requestCount: () => state.requests,
    responseCount: () => state.responses,
    activeConnectionCount: () => state.pairs.size,
    mutateNext: (mutator) => {
      if (state.nextRequestMutator) throw new Error("relay already has a pending capability.request mutator");
      state.nextRequestMutator = mutator;
    },
    mutateNextResponse: (mutator) => {
      if (state.nextResponseMutator) throw new Error("relay already has a pending capability.respond mutator");
      state.nextResponseMutator = mutator;
    },
    waitForRequestCount: (count, timeoutMs = 20_000) =>
      waitForCount({ waiters: state.requestWaiters, current: () => state.requests, count, timeoutMs, label: "requests" }),
    waitForResponseCount: (count, timeoutMs = 20_000) =>
      waitForCount({ waiters: state.responseWaiters, current: () => state.responses, count, timeoutMs, label: "responses" }),
    pauseNextExecute: (timeoutMs = 20_000) => new Promise((resolve, reject) => {
      if (state.nextExecutePause) { reject(new Error("relay already has a pending capability.execute pause")); return; }
      const timer = setTimeout(() => {
        state.nextExecutePause = undefined;
        reject(new Error(`relay did not observe capability.execute before timeout (requests=${state.requests}, responses=${state.responses})`));
      }, timeoutMs);
      state.nextExecutePause = { resolve, timer };
    }),
    close: () => closeRelay(state, server),
    isClosed: () => state.closed,
  };
  return relay;
}

function connectPair(state: RelayState, upstreamUrl: string, downstream: WebSocket): void {
  const pair: RelayPair = { downstream, upstream: new WebSocket(upstreamUrl), queued: [] };
  state.pairs.add(pair);
  downstream.on("message", (data) => forwardToCore(pair, data, state));
  downstream.on("close", () => closeRelayPair(state, pair));
  downstream.on("error", () => closeRelayPair(state, pair));
  pair.upstream.on("open", () => flushQueued(pair));
  pair.upstream.on("message", (data) => forwardToNode(pair, data, state));
  pair.upstream.on("close", () => closeRelayPair(state, pair));
  pair.upstream.on("error", () => closeRelayPair(state, pair));
}

function forwardToNode(pair: RelayPair, data: RawData, state: RelayState): void {
  const paused = captureExecutePause(pair, data, state);
  if (paused) return;
  const outgoing = transformCoreFrame(data, () => {
    state.requests += 1;
    settleWaiters(state.requestWaiters, state.requests);
    return state.requests;
  }, (request) => {
    const mutator = state.nextRequestMutator;
    state.nextRequestMutator = undefined;
    return mutator ? mutator(request) : request;
  });
  if (pair.downstream.readyState === WebSocket.OPEN) pair.downstream.send(outgoing);
}

function captureExecutePause(pair: RelayPair, data: RawData, state: RelayState): boolean {
  if (!state.nextExecutePause) return false;
  let parsed: { method?: unknown; params?: unknown };
  try { parsed = JSON.parse(String(data)) as typeof parsed; } catch { return false; }
  if (parsed.method !== "capability.execute") return false;
  let execute: CapabilityExecute;
  try { execute = CapabilityExecuteSchema.parse(parsed.params); } catch { return false; }
  const pending = state.nextExecutePause;
  state.nextExecutePause = undefined;
  clearTimeout(pending.timer);
  let released = false;
  pending.resolve({
    execute,
    release: () => {
      if (released) return;
      released = true;
      if (pair.downstream.readyState === WebSocket.OPEN) pair.downstream.send(String(data));
    },
  });
  return true;
}

function closeRelayPair(state: RelayState, pair: RelayPair): void {
  if (!state.pairs.delete(pair)) return;
  pair.downstream.terminate();
  pair.upstream.terminate();
}

async function closeRelay(
  state: RelayState,
  server: WebSocketServer,
): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  for (const pair of [...state.pairs]) closeRelayPair(state, pair);
  await closeServer(server);
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function forwardToCore(pair: RelayPair, data: RawData, state: RelayState): void {
  const text = transformNodeFrame(data, (response) => {
    state.responses += 1;
    settleWaiters(state.responseWaiters, state.responses);
    const mutator = state.nextResponseMutator;
    state.nextResponseMutator = undefined;
    return mutator ? mutator(response) : response;
  });
  if (pair.upstream.readyState === WebSocket.OPEN) pair.upstream.send(text);
  else if (pair.upstream.readyState === WebSocket.CONNECTING) pair.queued.push(text);
}

function flushQueued(pair: RelayPair): void {
  for (const data of pair.queued.splice(0)) pair.upstream.send(data);
}

function transformCoreFrame(
  data: RawData,
  nextOrdinal: () => number,
  mutate: (request: CapabilityRequest) => CapabilityRequest,
): RawData | string {
  const text = String(data);
  let parsed: { method?: unknown; params?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return text;
  }
  if (parsed.method !== "capability.request") return text;
  nextOrdinal();
  return JSON.stringify({ ...parsed, params: mutate(CapabilityRequestSchema.parse(parsed.params)) });
}

function transformNodeFrame(
  data: RawData,
  mutate: (response: CapabilityRespondParams) => CapabilityRespondParams,
): string {
  const text = String(data);
  let parsed: { method?: unknown; params?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return text;
  }
  if (parsed.method !== "capability.respond") return text;
  return JSON.stringify({ ...parsed, params: mutate(CapabilityRespondParamsSchema.parse(parsed.params)) });
}

function settleWaiters(waiters: Set<{ count: number; settle: () => void }>, actual: number): void {
  for (const waiter of waiters) {
    if (actual >= waiter.count) {
      waiters.delete(waiter);
      waiter.settle();
    }
  }
}

function waitForCount(spec: {
  waiters: Set<{ count: number; settle: () => void }>;
  current: () => number;
  count: number;
  timeoutMs: number;
  label: "requests" | "responses";
}): Promise<void> {
  if (spec.current() >= spec.count) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      spec.waiters.delete(waiter);
      reject(new Error(`relay observed ${spec.current()} capability ${spec.label}; expected ${spec.count}`));
    }, spec.timeoutMs);
    const waiter = { count: spec.count, settle: () => { clearTimeout(timer); resolve(); } };
    spec.waiters.add(waiter);
  });
}
