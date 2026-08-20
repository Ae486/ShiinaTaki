/**
 * INPUT:  n/a
 * OUTPUT: InMemoryTransport (duck-typed MCP transport with closedCount) + AsyncCallTransport (deferred
 *         tools/call) + PagedToolsTransport (cursor-honoring tools/list) + memConnect(entries -> transports)
 * POS:    core/testing — test-only MCP transports for the InMemoryTransport + closedCount pattern; never
 *         imported by production code
 */
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { McpConnect } from "../mcp/mcp-connect.ts";
import type { McpServerEntry } from "../mcp/mcp-config.ts";

export interface CallHandler {
  (msg: { id: number | string; params: { name: string; arguments?: Record<string, unknown> } }): unknown;
}

/** A duck-typed in-memory MCPTransport (copy of the shipped mock pattern) — never imported from dist. */
export class InMemoryTransport {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  closedCount = 0;
  protected readonly tools: Array<Record<string, unknown>>;
  private readonly call: CallHandler;
  constructor(tools: Array<Record<string, unknown>>, call: CallHandler) {
    this.tools = tools;
    this.call = call;
  }
  async start(): Promise<void> {}
  async send(message: { id?: number | string; method?: string }): Promise<void> {
    if (message.id === undefined) return; // notification
    const reply = this.handle(message as { id: number | string; method: string; params?: unknown });
    queueMicrotask(() => this.onmessage?.(reply));
  }
  protected replyTools(msg: { id: number | string; params?: unknown }): unknown {
    return { jsonrpc: "2.0", id: msg.id, result: { tools: this.tools } };
  }
  private handle(msg: { id: number | string; method: string; params?: unknown }): unknown {
    if (msg.method === "initialize")
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mem", version: "0.0.1" },
        },
      };
    if (msg.method === "tools/list") return this.replyTools(msg);
    if (msg.method === "tools/call") return this.call(msg as never);
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }
  async close(): Promise<void> {
    this.closedCount += 1;
    this.onclose?.();
  }
}

/** tools/call settles only when the injected async handler resolves — the in-flight lease fixture. */
export class AsyncCallTransport extends InMemoryTransport {
  private readonly settle: (msg: Parameters<CallHandler>[0]) => Promise<unknown>;
  constructor(tools: Array<Record<string, unknown>>, settle: (msg: Parameters<CallHandler>[0]) => Promise<unknown>) {
    super(tools, () => undefined);
    this.settle = settle;
  }  override async send(message: { id?: number | string; method?: string }): Promise<void> {
    if (message.id === undefined) return;
    const msg = message as { id: number | string; method: string; params?: unknown };
    if (msg.method !== "tools/call") {
      await super.send(message);
      return;
    }
    const reply = await this.settle(msg as never);
    this.onmessage?.(reply);
  }
}

/** tools/list honors `params.cursor` with a fixed page size — the local pagination fixture. */
export class PagedToolsTransport extends InMemoryTransport {
  private readonly pageSize: number;
  constructor(tools: Array<Record<string, unknown>>, pageSize: number, call: CallHandler) {
    super(tools, call);
    this.pageSize = pageSize;
  }
  protected override replyTools(msg: { id: number | string; params?: unknown }): unknown {
    const cursor = (msg.params as { cursor?: string } | undefined)?.cursor;
    const start = cursor === undefined ? 0 : Number(cursor);
    const slice = this.tools.slice(start, start + this.pageSize);
    const next = start + this.pageSize < this.tools.length ? String(start + this.pageSize) : undefined;
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: next === undefined ? { tools: slice } : { tools: slice, nextCursor: next },
    };
  }
}

export function memConnect(transports: Map<string, InMemoryTransport>): McpConnect {
  return (entry: McpServerEntry): Promise<MCPClient> => {
    const transport = transports.get(entry.key);
    if (!transport) throw new Error(`no transport for ${entry.key}`);
    return Promise.resolve(createMCPClient({ transport }));
  };
}
