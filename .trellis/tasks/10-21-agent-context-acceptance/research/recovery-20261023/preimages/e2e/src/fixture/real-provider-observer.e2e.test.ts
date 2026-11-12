import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { observeRealProvider } from "./real-provider-observer.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).map((close) => close())); });
const API_KEY = "local-test-key-must-not-be-recorded";
const BODY = Buffer.from(JSON.stringify({ model: "local-fixture", messages: [{ role: "user", content: "selected-memory-marker 😀" }],
  tools: [{ type: "function", function: { name: "public_tool", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } }] }));

async function upstream(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(() => response.destroy()); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local fixture did not bind");
  cleanup.push(async () => {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  });
  return `http://127.0.0.1:${address.port}/v1`;
}
async function observer(baseUrl: string) {
  const relay = await observeRealProvider({ baseUrl, apiKey: API_KEY,
    probeMarkers: { selectedMemory: "selected-memory-marker", primaryHistory: "primary-history-marker" } });
  cleanup.push(relay.close); return relay;
}
function post(baseUrl: string, signal?: AbortSignal) {
  return fetch(`${baseUrl}/chat/completions`, { method: "POST", body: BODY, signal,
    headers: { authorization: "Bearer untrusted-downstream-key", "content-type": "application/json" } });
}

describe("real provider observer with local HTTP only", () => {
  it("forwards request and successful stream bytes unchanged and records only boolean context probes", async () => {
    const expected = Buffer.from('data: {"text":"你好 😀"}\n\ndata: [DONE]\n\n');
    let actualBody = Buffer.alloc(0); let authorization: string | undefined;
    const baseUrl = await upstream(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      actualBody = Buffer.concat(chunks); authorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(expected.subarray(0, 19)); response.end(expected.subarray(19));
    });
    const relay = await observer(baseUrl); const response = await post(relay.baseUrl);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected); expect(actualBody).toEqual(BODY);
    expect(authorization).toBe(`Bearer ${API_KEY}`);
    expect(relay.requests).toEqual([{ status: 200, selectedMemoryPresent: true, primaryHistoryPresent: false,
      tools: [{ name: "public_tool", rootType: "object", rootKeys: ["type", "properties", "required", "additionalProperties"] }] }]);
    expect(JSON.stringify(relay.requests)).not.toContain("selected-memory-marker");
    expect(JSON.stringify(relay.requests)).not.toContain(API_KEY);
  });

  it.each(["invalid_request_error", "private-error-code"])("forwards complete error bytes but only allow-lists %s metadata", async (code) => {
    const privateText = `private prompt 😀 ${API_KEY}`;
    const bytes = Buffer.from(JSON.stringify({ error: { code, type: "invalid_request_error",
      message: `Function schema must have type object. ${privateText}` } }));
    const relay = await observer(await upstream((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" }); response.end(bytes);
    }));
    const response = await post(relay.baseUrl);
    expect(response.status).toBe(400); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(relay.requests[0]).toMatchObject({ status: 400, error: "upstream-http-error", schemaObjectRootRejected: true,
      providerErrorType: "invalid_request_error" });
    expect(relay.requests[0]?.providerErrorCode).toBe(code === "invalid_request_error" ? code : undefined);
    const evidence = JSON.stringify(relay.requests);
    expect(evidence).not.toContain(API_KEY); expect(evidence).not.toContain("private prompt");
    expect(evidence).not.toContain("private-error-code");
  });

  it("streams an oversized error without retaining its body or truncating downstream evidence", async () => {
    const bytes = Buffer.from(JSON.stringify({ error: { message: "private-large-response".repeat(100_000), code: "invalid_request_error" } }));
    const relay = await observer(await upstream((_request, response) => { response.writeHead(400); response.end(bytes); }));
    const response = await post(relay.baseUrl);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(JSON.stringify(relay.requests).length).toBeLessThan(1000);
    expect(JSON.stringify(relay.requests)).not.toContain("private-large-response");
    expect(relay.requests[0]?.providerErrorCode).toBeUndefined();
  });

  it("records a safe transport failure before receiving upstream headers", async () => {
    const relay = await observer(await upstream((_request, response) => { response.destroy(new Error("private network failure")); }));
    const response = await post(relay.baseUrl);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { message: "Real provider transport failed" } });
    expect(relay.requests[0]?.error).toBe("transport-failed");
    expect(JSON.stringify(relay.requests)).not.toContain("private network failure");
  });

  it("leaves an interrupted successful stream incomplete without appending fabricated JSON", async () => {
    let interrupt: () => void = () => undefined;
    const relay = await observer(await upstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: genuine prefix\n\n");
      interrupt = () => { response.destroy(new Error("private interrupted stream")); };
    }));
    const response = await post(relay.baseUrl); const reader = response.body!.getReader();
    const first = await reader.read(); expect(Buffer.from(first.value!).toString()).toBe("data: genuine prefix\n\n");
    interrupt(); await expect(reader.read()).rejects.toThrow();
    await vi.waitFor(() => expect(relay.requests[0]?.error).toBe("transport-failed"));
    expect(relay.requests[0]?.status).toBe(200);
    expect(JSON.stringify(relay.requests)).not.toContain("private interrupted stream");
  });

  it("aborts a stalled upstream and makes close idempotent", async () => {
    let arrived = false; let upstreamClosed = false;
    const relay = await observer(await upstream((_request, response) => {
      arrived = true; response.on("close", () => { upstreamClosed = true; });
    }));
    const pending = post(relay.baseUrl).catch(() => undefined);
    await vi.waitFor(() => expect(arrived).toBe(true));
    const first = relay.close(); expect(relay.close()).toBe(first); await first; await pending;
    await vi.waitFor(() => expect(upstreamClosed).toBe(true));
    expect(relay.requests[0]?.error).toBe("observer-closed");
  });

  it("propagates downstream cancellation to the upstream stream", async () => {
    let upstreamClosed = false;
    const relay = await observer(await upstream((_request, response) => {
      response.on("close", () => { upstreamClosed = true; });
      response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: start\n\n");
    }));
    const abort = new AbortController(); const response = await post(relay.baseUrl, abort.signal);
    const reader = response.body!.getReader(); await reader.read(); abort.abort();
    await expect(reader.read()).rejects.toThrow();
    await vi.waitFor(() => expect(upstreamClosed).toBe(true));
    expect(relay.requests[0]?.error).toBe("client-closed");
  });

  it("honors downstream backpressure instead of draining the whole provider into memory", async () => {
    const chunk = Buffer.alloc(32768, 120); const total = 64 * 1024 * 1024; let sent = 0;
    const relay = await observer(await upstream(async (_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      while (sent < total) { sent += chunk.length; if (!response.write(chunk)) await once(response, "drain"); }
      response.end();
    }));
    const incoming = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest(`${relay.baseUrl}/chat/completions`, { method: "POST" }, (response) => { response.pause(); resolve(response); });
      request.on("error", reject); request.end(BODY);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toBeLessThan(total);
    let received = 0; incoming.on("data", (bytes: Buffer) => { received += bytes.length; });
    const ended = once(incoming, "end"); incoming.resume(); await ended;
    expect(received).toBe(total); expect(sent).toBe(total);
  });
});
