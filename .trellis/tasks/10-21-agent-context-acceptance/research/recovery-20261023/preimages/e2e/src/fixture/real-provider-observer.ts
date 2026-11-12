/**
 * INPUT: approved provider connection and real Core OpenAI-compatible requests
 * OUTPUT: unchanged body forwarding and bounded content-free request/error diagnostics
 * POS: e2e/fixture — observes the real provider; never scripts or edits successful model responses
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

export interface ProviderObservation {
  status?: number;
  tools: Array<{ name: string; rootType: string | null; rootKeys: string[] }>;
  error?: Failure;
  providerErrorCode?: string;
  providerErrorType?: string;
  schemaObjectRootRejected?: boolean;
  selectedMemoryPresent?: boolean;
  primaryHistoryPresent?: boolean;
}

const REQUEST_BYTES = 2_000_000;
const ERROR_PROBE_BYTES = 8192;
const ERROR_CODES = new Set(["invalid_request_error", "invalid_request", "invalid_function_parameters",
  "invalid_tool_schema", "schema_validation_error", "authentication_error", "invalid_api_key",
  "insufficient_quota", "rate_limit_exceeded", "rate_limit_error", "server_error", "api_error",
  "context_length_exceeded", "model_not_found", "not_found_error", "overloaded_error"]);
const SCHEMA_KEYS = new Set(["type", "properties", "required", "additionalProperties", "anyOf", "oneOf",
  "allOf", "$schema", "$defs", "$ref", "description", "title"]);
type Failure = "upstream-http-error" | "transport-failed" | "deadline-exceeded" | "client-closed"
  | "observer-closed" | "invalid-request" | "request-too-large";
interface Forwarding {
  controller: AbortController;
  observed: ProviderObservation;
  abort(reason: Failure): void;
}

export async function observeRealProvider(input: {
  baseUrl: string; apiKey: string;
  probeMarkers?: { selectedMemory: string; primaryHistory: string };
}) {
  const requests: ProviderObservation[] = [];
  const active = new Set<Forwarding>();
  const operations = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  const server = createServer((request, response) => {
    const operation = forward(request, response);
    operations.add(operation);
    void operation.then(() => operations.delete(operation), () => operations.delete(operation));
  });
  async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404); response.end(); return;
    }
    const observed: ProviderObservation = { tools: [] }; requests.push(observed);
    const controller = new AbortController();
    const forwarding: Forwarding = { controller, observed, abort(reason) {
      if (controller.signal.aborted) return;
      observed.error = reason; controller.abort();
    } };
    active.add(forwarding);
    const onClose = () => { if (!response.writableEnded) forwarding.abort("client-closed"); };
    const onAbort = () => { if (!request.complete) request.destroy(); };
    response.on("close", onClose);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => forwarding.abort("deadline-exceeded"), 180_000);
    try {
      const body = await readRequest(request, { response, forwarding });
      if (!body) return;
      observeRequest(body, observed, input.probeMarkers);
      const upstream = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
        body, signal: controller.signal, redirect: "error" });
      observed.status = upstream.status;
      if (!upstream.ok) observed.error = "upstream-http-error";
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      await streamResponse(upstream, response, forwarding);
      response.end();
    } catch {
      observed.error ??= "transport-failed";
      // A partial real response must stay truncated, never gain fabricated trailing JSON.
      if (!response.destroyed) {
        if (response.headersSent) response.destroy();
        else { response.writeHead(502, { "content-type": "application/json" }); response.end('{"error":{"message":"Real provider transport failed"}}'); }
      }
    } finally {
      clearTimeout(timer); response.off("close", onClose);
      controller.signal.removeEventListener("abort", onAbort); active.delete(forwarding);
    }
  }
  server.listen(0, "127.0.0.1");
  try { await once(server, "listening"); }
  catch (error) { server.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("provider observer failed to bind"); }
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests,
    close(): Promise<void> {
      closing ??= (async () => {
        const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        for (const forwarding of active) forwarding.abort("observer-closed");
        server.closeAllConnections();
        await Promise.allSettled([...operations]);
        await closed;
      })();
      return closing;
    } };
}

async function readRequest(request: IncomingMessage, input: { response: ServerResponse; forwarding: Forwarding }): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    if (input.forwarding.controller.signal.aborted) throw new Error("request retired");
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
    if (size > REQUEST_BYTES) {
      input.forwarding.observed.error = "request-too-large";
      input.response.writeHead(413); input.response.end(); return;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function observeRequest(body: Buffer, observed: ProviderObservation, markers?: { selectedMemory: string; primaryHistory: string }): void {
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); }
  catch { observed.error = "invalid-request"; throw new Error("invalid request JSON"); }
  const request = record(parsed);
  if (!request) { observed.error = "invalid-request"; throw new Error("request must be an object"); }
  const tools = Array.isArray(request.tools) ? request.tools.slice(0, 128) : [];
  observed.tools = tools.map((tool) => {
    const fn = record(record(tool)?.function); const parameters = record(fn?.parameters);
    return { name: typeof fn?.name === "string" ? fn.name.slice(0, 200) : "",
      rootType: typeof parameters?.type === "string" && ["object", "array", "string", "number", "integer", "boolean", "null"].includes(parameters.type) ? parameters.type : null,
      rootKeys: Object.keys(parameters ?? {}).filter((key) => SCHEMA_KEYS.has(key)) };
  });
  if (markers) {
    const messages = JSON.stringify(request.messages ?? []);
    observed.selectedMemoryPresent = markers.selectedMemory.length > 0 && messages.includes(markers.selectedMemory);
    observed.primaryHistoryPresent = markers.primaryHistory.length > 0 && messages.includes(markers.primaryHistory);
  }
}

async function streamResponse(upstream: Response, response: ServerResponse, forwarding: Forwarding): Promise<void> {
  const prefix: Buffer[] = []; let captured = 0;
  if (upstream.body) for await (const chunk of upstream.body) {
    if (!upstream.ok && captured < ERROR_PROBE_BYTES) {
      const bytes = Buffer.from(chunk.subarray(0, ERROR_PROBE_BYTES - captured));
      prefix.push(bytes); captured += bytes.length;
    }
    // Bound buffering to the downstream socket instead of speed-reading an unbounded provider stream.
    if (!response.write(chunk)) await once(response, "drain", { signal: forwarding.controller.signal });
  }
  if (!upstream.ok) observeError(Buffer.concat(prefix), forwarding.observed);
}

function observeError(prefix: Buffer, observed: ProviderObservation): void {
  const text = prefix.toString("utf8");
  observed.schemaObjectRootRejected = /(?:schema|parameters).{0,256}(?:must|should).{0,256}object/is.test(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return; }
  const error = record(record(parsed)?.error);
  for (const [field, output] of [["code", "providerErrorCode"], ["type", "providerErrorType"]] as const) {
    const value = error?.[field];
    if (typeof value === "string" && ERROR_CODES.has(value)) observed[output] = value;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
