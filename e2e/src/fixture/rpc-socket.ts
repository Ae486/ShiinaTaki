/**
 * INPUT:  the core WS url + inbound frames (id-correlated responses and server notifications)
 * OUTPUT: openRpcSocket(url) -> RpcSocket { request, notifications, waitForNotification, close }
 * POS:    e2e/fixture — the raw out-of-process JSON-RPC client; role semantics live in operator-drivers
 */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";

export interface RpcNotification {
  method: string;
  params: unknown;
}

export interface RpcSocket {
  /** Sends a request and resolves the raw response frame (success or error — callers parse with shared schemas). */
  request(method: string, params: unknown): Promise<unknown>;
  notifications(): readonly RpcNotification[];
  waitForNotification(pred: (note: RpcNotification) => boolean, timeoutMs?: number): Promise<RpcNotification>;
  close(): void;
}

interface NoteWaiter {
  pred: (note: RpcNotification) => boolean;
  settle: (note: RpcNotification) => void;
}

interface Inbox {
  pending: Map<string, (frame: unknown) => void>;
  notes: RpcNotification[];
  waiters: Set<NoteWaiter>;
}

export async function openRpcSocket(url: string): Promise<RpcSocket> {
  const ws = new WebSocket(url);
  await once(ws, "open");
  const inbox: Inbox = { pending: new Map(), notes: [], waiters: new Set() };
  ws.on("message", (data) => routeFrame(inbox, JSON.parse(String(data))));
  return {
    request: (method, params) => sendRequest(ws, inbox, { method, params }),
    notifications: () => inbox.notes,
    waitForNotification: (pred, timeoutMs = 20_000) => waitForNote(inbox, pred, timeoutMs),
    close: () => ws.close(),
  };
}

function routeFrame(inbox: Inbox, frame: unknown): void {
  const { id, method, params } = frame as { id?: string | number | null; method?: string; params?: unknown };
  if (id !== undefined && id !== null) {
    const settle = inbox.pending.get(String(id));
    if (settle) {
      inbox.pending.delete(String(id));
      settle(frame);
    }
    return;
  }
  if (typeof method !== "string") return;
  const note: RpcNotification = { method, params };
  inbox.notes.push(note);
  for (const waiter of inbox.waiters) {
    if (waiter.pred(note)) {
      inbox.waiters.delete(waiter);
      waiter.settle(note);
    }
  }
}

function sendRequest(ws: WebSocket, inbox: Inbox, call: { method: string; params: unknown }): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      inbox.pending.delete(id);
      reject(new Error(`request ${call.method} timed out`));
    }, 30_000);
    inbox.pending.set(id, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: call.method, params: call.params }));
  });
}

function waitForNote(
  inbox: Inbox,
  pred: (note: RpcNotification) => boolean,
  timeoutMs: number,
): Promise<RpcNotification> {
  const existing = inbox.notes.find(pred);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      inbox.waiters.delete(waiter);
      reject(new Error(`notification wait timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const waiter: NoteWaiter = {
      pred,
      settle: (note) => {
        clearTimeout(timer);
        resolve(note);
      },
    };
    inbox.waiters.add(waiter);
  });
}
