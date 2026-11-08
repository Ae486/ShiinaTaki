/**
 * INPUT:  inbound WS text frames (JSON-RPC 2.0) from local clients
 * OUTPUT: startWsServer({ host, port, registry, connectionRegistry, logger }) -> { port, close }
 * POS:    core/server — the only socket-owning module; per-socket auth state + pre-auth gate, then method dispatch
 */
import { once } from "node:events";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createJSONRPCErrorResponse, createJSONRPCNotification } from "json-rpc-2.0";
import {
  CONNECT_METHOD,
  ErrorCodeSchema,
  JSON_RPC_ERROR_CODES,
  JsonRpcInboundFrameSchema,
  type JsonRpcId,
  type JsonRpcInboundFrame,
  type JsonRpcRequest,
} from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import { appErrorResponse } from "./app-error.ts";
import type { Connection, ConnectionRegistry } from "./connection-registry.ts";
import type { MethodContext, MethodRegistry } from "./method-registry.ts";

export interface WsServerOptions {
  host: string;
  port: number;
  registry: MethodRegistry;
  connectionRegistry: ConnectionRegistry;
  logger: Logger;
}

export interface WsServer {
  /** The actually-bound port (resolves the ephemeral port when started with 0). */
  port: number;
  close(): Promise<void>;
}

export async function startWsServer(options: WsServerOptions): Promise<WsServer> {
  const { host, port, registry, connectionRegistry, logger } = options;
  const log = logger.child({ mod: "server" });
  // Status bursts can run expensive synchronous reads. Yield between frames so
  // pending provider responses and their deadlines can progress between requests.
  const wss = new WebSocketServer({ host, port, allowSynchronousEvents: false });

  wss.on("connection", (socket, request) => {
    // Socket-level notify: server-initiated pushes (chat/timeline events, the capability channel) reach
    // exactly this socket. Stored on the connection so the capability broker can notify a node directly.
    const notify: MethodContext["notify"] = (method, params) =>
      reply(socket, createJSONRPCNotification(method, params));
    // Peer address (ws passes the upgrade request as the 2nd arg) — the connect handler uses it for
    // loopback auto-trust (P3). Undefined for an unknown peer ⇒ never auto-trusted (fail-closed).
    const connection = connectionRegistry.create(notify, request.socket.remoteAddress, () => socket.close());
    // Cleanups registered by handlers (via ctx.onClose) for THIS socket — run once on close.
    const closeListeners: Array<() => void> = [];
    log.info("client connected");
    socket.on("error", (err) => log.warn({ err: err.message }, "socket error"));
    socket.on("message", (data) => void handleMessage({ socket, connection, closeListeners, data, registry, log }));
    socket.on("close", () => {
      for (const listener of closeListeners) listener();
      connectionRegistry.remove(connection);
      log.info("client disconnected");
    });
  });

  await once(wss, "listening"); // rejects if binding emits 'error' first
  wss.on("error", (err) => log.error({ err: err.message }, "ws server error"));
  const port_ = boundPort(wss, port);
  log.info({ host, port: port_ }, "ws server listening");

  return { port: port_, close: () => closeServer(wss) };
}

interface HandleArgs {
  socket: WebSocket;
  connection: Connection;
  closeListeners: Array<() => void>;
  data: RawData;
  registry: MethodRegistry;
  log: Logger;
}

async function handleMessage(args: HandleArgs): Promise<void> {
  const frame = parseAndValidate(args);
  if (!frame) {
    // Fail-closed pre-auth: an unauthenticated peer gets exactly one envelope error, then the
    // socket dies — it has no legitimate reason to send malformed frames, and a lenient path
    // would let it hold sockets open indefinitely (v1.5 VPS exposure). Authenticated peers keep
    // the tolerant #3 behavior: one bad frame must not kill a live session.
    if (args.connection.state.status !== "authenticated") args.socket.close();
    return;
  }
  if (!enforcePreAuthGate(args, frame)) return;
  if (!("id" in frame)) {
    args.log.debug({ method: frame.method }, "ignoring notification");
    return;
  }
  await dispatchFrame(args, frame);
}

function parseAndValidate({ socket, data }: HandleArgs): JsonRpcInboundFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    reply(socket, createJSONRPCErrorResponse(null, JSON_RPC_ERROR_CODES.PARSE_ERROR, "Parse error"));
    return null;
  }
  const frame = JsonRpcInboundFrameSchema.safeParse(parsed);
  if (!frame.success) {
    const id = recoverableId(parsed);
    reply(socket, createJSONRPCErrorResponse(id, JSON_RPC_ERROR_CODES.INVALID_REQUEST, "Invalid Request"));
    return null;
  }
  return frame.data;
}

// Fail-closed: an unauthenticated socket may send only a `connect` request; anything else gets a
// NOT_AUTHENTICATED app error and the socket is closed (prd §3 handshake step 2).
function enforcePreAuthGate({ socket, connection }: HandleArgs, frame: JsonRpcInboundFrame): boolean {
  if (connection.state.status === "authenticated") return true;
  if ("id" in frame && frame.method === CONNECT_METHOD) return true;
  const id = "id" in frame ? frame.id : null;
  reply(socket, appErrorResponse(id, ErrorCodeSchema.enum.NOT_AUTHENTICATED, "not authenticated"));
  socket.close();
  return false;
}

async function dispatchFrame({ socket, connection, closeListeners, registry }: HandleArgs, frame: JsonRpcRequest): Promise<void> {
  let closeRequested = false;
  const ctx: MethodContext = {
    // Reuse the socket-level notify stored on the connection (same target socket).
    notify: connection.notify ?? ((method, params) => reply(socket, createJSONRPCNotification(method, params))),
    connection,
    close: () => {
      closeRequested = true;
    },
    onClose: (cb) => closeListeners.push(cb),
  };
  reply(socket, await registry.dispatch(frame, ctx));
  if (closeRequested) socket.close(); // after the reply is queued, so the error frame flushes first
}

function reply(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function recoverableId(parsed: unknown): JsonRpcId | null {
  if (typeof parsed === "object" && parsed !== null && "id" in parsed) {
    const { id } = parsed as { id: unknown };
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}

function boundPort(wss: WebSocketServer, fallback: number): number {
  const address = wss.address();
  return typeof address === "object" && address !== null ? address.port : fallback;
}

function closeServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const client of wss.clients) client.terminate();
    wss.close((err) => (err ? reject(err) : resolve()));
  });
}
