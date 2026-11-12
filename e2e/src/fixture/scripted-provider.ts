/**
 * INPUT: a scenario-owned response function and actual OpenAI-compatible request bodies from an isolated Core.
 * OUTPUT: a loopback SSE provider, captured requests, and deterministic transport teardown.
 * POS: e2e/fixture — test-only model transport; no remote credentials, model stub inside Core, or content logging.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { listenLoopbackHttp } from "./loopback-http.ts";

export interface ScriptedReply {
  text?: string;
  calls?: ReadonlyArray<{ name: string; arguments: unknown }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ScriptedProvider {
  baseUrl: string;
  requests: readonly Record<string, unknown>[];
  errors: readonly Error[];
  close(): Promise<void>;
}

export async function startScriptedProvider(
  reply: (request: Record<string, unknown>, index: number) => ScriptedReply | Promise<ScriptedReply>,
): Promise<ScriptedProvider> {
  const requests: Record<string, unknown>[] = [];
  const errors: Error[] = [];
  const server = createServer((request, response) => {
    void answer(request, response, { requests, reply }).catch((cause: unknown) => {
      errors.push(cause instanceof Error ? cause : new Error("scripted provider failed"));
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "scripted provider failed" } }));
    });
  });
  const port = await listenLoopbackHttp(server);
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`, requests, errors,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  scenario: {
    requests: Record<string, unknown>[];
    reply: (request: Record<string, unknown>, index: number) => ScriptedReply | Promise<ScriptedReply>;
  },
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid provider request");
  const captured = body as Record<string, unknown>;
  const index = scenario.requests.push(captured) - 1;
  const scripted = await scenario.reply(captured, index);
  if (captured.stream !== true) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: randomUUID(), object: "chat.completion", created: 1,
      model: captured.model, choices: [{ index: 0, message: { role: "assistant", content: scripted.text ?? "" }, finish_reason: "stop" }],
      ...(scripted.usage ? { usage: scripted.usage } : {}) }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const id = randomUUID();
  const emit = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({
    id, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`);
  emit({ role: "assistant", ...(scripted.text === undefined ? {} : { content: scripted.text }) });
  const calls = scripted.calls ?? [];
  for (const [callIndex, call] of calls.entries()) emit({ tool_calls: [{
    index: callIndex, id: `call-${randomUUID()}`, type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }] });
  emit({}, calls.length ? "tool_calls" : "stop");
  if (scripted.usage) response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [], usage: scripted.usage })}\n\n`);
  response.end("data: [DONE]\n\n");
}
