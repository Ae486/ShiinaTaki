/**
 * INPUT:  an upstream Core WS URL and an optional capability.request frame transformer
 * OUTPUT: a loopback-only test relay with request observation, forced Node disconnect, and bounded shutdown
 * POS:    e2e/fixture — test-only Core-to-Node fault injection; never imported by production transport
 */
import { once } from "node:events";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CapabilityRequestSchema, type CapabilityRequest } from "@taki/shared";
import { getFreePort } from "./procs.ts";

export type CapabilityRequestMutator = (
  request: CapabilityRequest,
) => CapabilityRequest;

export interface CapabilityRelay {
  url: string;
  requestCount(): number;
  activeConnectionCount(): number;
  mutateNext(mutator: CapabilityRequestMutator): void;
  waitForRequestCount(count: number, timeoutMs?: number): Promise<void>;
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
  waiters: Set<{ count: number; settle: () => void }>;
  requests: number;
  closed: boolean;
  nextMutator?: CapabilityRequestMutator;
}

export async function startCapabilityRelay(upstreamUrl: string): Promise<CapabilityRelay> {
  const port = await getFreePort();
  const server = new WebSocketServer({ host: "127.0.0.1", port });
  const state: RelayState = { pairs: new Set(), waiters: new Set(), requests: 0, closed: false };

  server.on("connection", connectPair);
  await once(server, "listening");

  const relay: CapabilityRelay = {
    url: `ws://127.0.0.1:${port}`,
    requestCount: () => state.requests,
    activeConnectionCount: () => state.pairs.size,
    mutateNext: (mutator) => {
      if (state.nextMutator) throw new Error("relay already has a pending capability.request mutator");
      state.nextMutator = mutator;
    },
    waitForRequestCount: (count, timeoutMs = 20_000) =>
      waitForCount({ waiters: state.waiters, current: () => state.requests, count, timeoutMs }),
    close: () => closeRelay(state, closePair, server),
    isClosed: () => state.closed,
  };
  return relay;

  function closePair(pair: RelayPair): void {
    if (!state.pairs.delete(pair)) return;
    pair.downstream.terminate();
    pair.upstream.terminate();
  }

  function connectPair(downstream: WebSocket): void {
    const pair: RelayPair = { downstream, upstream: new WebSocket(upstreamUrl), queued: [] };
    state.pairs.add(pair);
    downstream.on("message", (data) => forwardToCore(pair, data));
    downstream.on("close", () => closePair(pair));
    downstream.on("error", () => closePair(pair));
    pair.upstream.on("open", () => flushQueued(pair));
    pair.upstream.on("message", (data) => forwardToNode(pair, data));
    pair.upstream.on("close", () => closePair(pair));
    pair.upstream.on("error", () => closePair(pair));
  }

  function forwardToNode(pair: RelayPair, data: RawData): void {
    const outgoing = transformCoreFrame(data, () => {
      state.requests += 1;
      settleWaiters(state.waiters, state.requests);
      return state.requests;
    }, (request) => {
      const mutator = state.nextMutator;
      state.nextMutator = undefined;
      return mutator ? mutator(request) : request;
    });
    if (pair.downstream.readyState === WebSocket.OPEN) pair.downstream.send(outgoing);
  }
}

async function closeRelay(
  state: RelayState,
  closePair: (pair: RelayPair) => void,
  server: WebSocketServer,
): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  for (const pair of [...state.pairs]) closePair(pair);
  await closeServer(server);
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function forwardToCore(pair: RelayPair, data: RawData): void {
  const text = String(data);
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
}): Promise<void> {
  if (spec.current() >= spec.count) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      spec.waiters.delete(waiter);
      reject(new Error(`relay observed ${spec.current()} capability requests; expected ${spec.count}`));
    }, spec.timeoutMs);
    const waiter = { count: spec.count, settle: () => { clearTimeout(timer); resolve(); } };
    spec.waiters.add(waiter);
  });
}
