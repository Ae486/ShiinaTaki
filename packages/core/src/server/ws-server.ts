/**
 * INPUT:  inbound WS text frames (JSON-RPC 2.0) from local clients
 * OUTPUT: startWsServer({ host, port, registry, logger }) -> { port, close }
 * POS:    core/server — the only module owning sockets; binds loopback, zod-validates frames, dispatches via method-registry
 */
import { once } from "node:events";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createJSONRPCErrorResponse, createJSONRPCNotification } from "json-rpc-2.0";
import { JSON_RPC_ERROR_CODES, JsonRpcInboundFrameSchema, type JsonRpcId } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import type { MethodContext, MethodRegistry } from "./method-registry.ts";

export interface WsServerOptions {
  host: string;
  port: number;
  registry: MethodRegistry;
  logger: Logger;
}

export interface WsServer {
  /** The actually-bound port (resolves the ephemeral port when started with 0). */
  port: number;
  close(): Promise<void>;
}

// Loopback only; pairing/auth is a later slice (never binds 0.0.0.0).
export async function startWsServer(options: WsServerOptions): Promise<WsServer> {
  const { host, port, registry, logger } = options;
  const log = logger.child({ mod: "server" });
  const wss = new WebSocketServer({ host, port });

  wss.on("connection", (socket) => {
    log.info("client connected");
    socket.on("error", (err) => log.warn({ err: err.message }, "socket error"));
    socket.on("message", (data) => void handleMessage({ socket, data, registry, log }));
    socket.on("close", () => log.info("client disconnected"));
  });

  await once(wss, "listening"); // rejects if binding emits 'error' first
  wss.on("error", (err) => log.error({ err: err.message }, "ws server error"));
  const port_ = boundPort(wss, port);
  log.info({ host, port: port_ }, "ws server listening");

  return { port: port_, close: () => closeServer(wss) };
}

interface HandleArgs {
  socket: WebSocket;
  data: RawData;
  registry: MethodRegistry;
  log: Logger;
}

async function handleMessage({ socket, data, registry, log }: HandleArgs): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    reply(socket, createJSONRPCErrorResponse(null, JSON_RPC_ERROR_CODES.PARSE_ERROR, "Parse error"));
    return;
  }

  const frame = JsonRpcInboundFrameSchema.safeParse(parsed);
  if (!frame.success) {
    const id = recoverableId(parsed);
    reply(socket, createJSONRPCErrorResponse(id, JSON_RPC_ERROR_CODES.INVALID_REQUEST, "Invalid Request"));
    return;
  }
  if (!("id" in frame.data)) {
    log.debug({ method: frame.data.method }, "ignoring notification");
    return;
  }

  const ctx: MethodContext = {
    notify: (method, params) => reply(socket, createJSONRPCNotification(method, params)),
  };
  reply(socket, await registry.dispatch(frame.data, ctx));
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
