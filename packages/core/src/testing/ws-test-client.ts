/**
 * INPUT:  an open ws socket (makeClient) + raw inbound frames; connect params for the pairing helpers
 * OUTPUT: TestClient (send/sendRaw/take/waitClosed/close) + frame helpers (sendConnect, appCode, notification)
 * POS:    core/testing — the WS integration-test client harness; test-only, shared by server test files
 */
import { once } from "node:events";
import { expect } from "vitest";
import { WebSocket } from "ws";
import {
  CONNECT_METHOD,
  HOST_CATALOG_SCHEMA_VERSION,
  HOST_CONTROL_PROTOCOL_VERSION,
  JSON_RPC_APP_ERROR,
  JsonRpcErrorResponseSchema,
  JsonRpcNotificationSchema,
  type Role,
} from "@taki/shared";

export interface TestClient {
  send(frame: unknown): void;
  sendRaw(text: string): void;
  take(count: number): Promise<unknown[]>;
  waitClosed(): Promise<void>;
  close(): void;
}

export function makeClient(ws: WebSocket): TestClient {
  const queue: unknown[] = [];
  let waiter: ((frame: unknown) => void) | null = null;
  ws.on("message", (data) => {
    const frame: unknown = JSON.parse(data.toString());
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(frame);
    } else {
      queue.push(frame);
    }
  });
  const closed = once(ws, "close");
  const next = (): Promise<unknown> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) resolve(queued);
      else waiter = resolve;
    });
  return {
    send: (frame) => ws.send(JSON.stringify(frame)),
    sendRaw: (text) => ws.send(text),
    take: async (count) => {
      const frames: unknown[] = [];
      for (let i = 0; i < count; i += 1) frames.push(await next());
      return frames;
    },
    waitClosed: () => closed.then(() => undefined),
    close: () => ws.close(),
  };
}

/** Opens a socket to `url`, waits for it to connect, and wraps it. Caller tracks it for teardown. */
export async function openClient(url: string): Promise<TestClient> {
  const ws = new WebSocket(url);
  await once(ws, "open");
  return makeClient(ws);
}

export function sendConnect(
  client: TestClient,
  params: Record<string, unknown> & { role?: Role },
  id = "c1",
): void {
  const host = params.role === "node"
    ? {
        protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION },
        catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION],
      }
    : undefined;
  client.send({ jsonrpc: "2.0", id, method: CONNECT_METHOD, params: { host, ...params } });
}

/** Asserts the frame is an app-error envelope and returns its machine-readable ErrorCode. */
export function appCode(frame: unknown): string {
  const res = JsonRpcErrorResponseSchema.parse(frame);
  expect(res.error.code).toBe(JSON_RPC_APP_ERROR);
  return (res.error.data as { code: string }).code;
}

export function notification(frame: unknown): { method: string; params: unknown } {
  const note = JsonRpcNotificationSchema.parse(frame);
  return { method: note.method, params: note.params };
}
