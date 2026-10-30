import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getEventListeners } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createHindsightClient } from "./hindsight-client.ts";
import { hindsightHttpTransport } from "./hindsight-http-transport.ts";

const KEY = "owned-http-test-key";
const HEALTH = JSON.stringify({ status: "healthy", database: "connected" });
const TRUNCATED_RESPONSES = ["gzip", "x-gzip", "deflate", "br"].flatMap((encoding) =>
  ["representation", "connection"].map((mode) => ({ encoding, mode })));
type Later = (milliseconds: number, callback: () => void) => void;

// Public, synthetic test material generated only for a local rejection test; never a trusted or deployed identity.
const OWNED_TLS = {
  key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgChs5sNO/jPQr0FVq
tx1Ye/tu9GCgNWX7Ntm7OSVw8BahRANCAARq3ltYNOKv1T4PodFeGu3BhUq2Calz
mTNToKcxTJZPI3Ivb/Jc09snAhQ9JRRpMd8P7forCiDq+oGLv+LZRz8e
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIBRzCB7QIUIqwwvZygkGuHWhzqPUMVOAoa9+EwCgYIKoZIzj0EAwIwJjEkMCIG
A1UEAwwbb3duZWQtbG9vcGJhY2stdGVzdC5pbnZhbGlkMB4XDTI2MDkxMDA3MDUy
NloXDTM2MDkwNzA3MDUyNlowJjEkMCIGA1UEAwwbb3duZWQtbG9vcGJhY2stdGVz
dC5pbnZhbGlkMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEat5bWDTir9U+D6HR
XhrtwYVKtgmpc5kzU6CnMUyWTyNyL2/yXNPbJwIUPSUUaTHfD+36Kwog6vqBi7/i
2Uc/HjAKBggqhkjOPQQDAgNJADBGAiEA/t6sUpbXhX8rfWfEWykl9EYFHW1pIDzV
XvdQNO/ghGYCIQCB0D410/Vw68qsrOvQ5iZlqbMhySJeygeNLXxHH8vjzg==
-----END CERTIFICATE-----`,
};

async function withHttpServer<T>(input: {
  tls?: boolean;
  handle: (request: IncomingMessage, response: ServerResponse, later: Later) => void;
  run: (endpoint: string) => Promise<T>;
}): Promise<T> {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later: Later = (milliseconds, callback) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, milliseconds);
    timers.add(timer);
  };
  const handle = (request: IncomingMessage, response: ServerResponse) => input.handle(request, response, later);
  const server = input.tls ? createHttpsServer(OWNED_TLS, handle) : createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("owned HTTP endpoint missing");
  try { return await input.run(`${input.tls ? "https" : "http"}://127.0.0.1:${address.port}`); }
  finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function client(endpoint: string) {
  return createHindsightClient({ endpoint, resolveApiKey: () => KEY });
}

describe("Hindsight default HTTP transport", () => {
  it("uses the production HTTP delegate without depending on global fetch", async () => {
    let requests = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected global fetch dependency"));
    try {
      await withHttpServer({ handle: (request, response, later) => {
        requests++;
        expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
        later(30, () => response.end(HEALTH));
      }, run: async (endpoint) => {
        await expect(client(endpoint).health({ timeoutMs: 1_000 })).resolves.toEqual({ status: "healthy", database: "connected" });
      } });
      expect(requests).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it.each([20, 80, 160])("accepts delayed headers and body within one budget on independent endpoints (%i ms)", async (delay) => {
    await Promise.all(["headers", "body"].map((phase) => withHttpServer({ handle: (_request, response, later) => {
      if (phase === "body") { response.writeHead(200); response.write(HEALTH.slice(0, 5)); }
      later(delay, () => response.end(phase === "body" ? HEALTH.slice(5) : HEALTH));
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 1_000 })).resolves.toMatchObject({ status: "healthy" });
    } })));
  });

  it.each(["headers", "body"])("enforces a finite deadline while waiting for %s", async (phase) => {
    let requests = 0;
    await withHttpServer({ handle: (_request, response, later) => {
      requests++;
      if (phase === "body") { response.writeHead(200); response.write(HEALTH.slice(0, 5)); }
      later(300, () => response.end(phase === "body" ? HEALTH.slice(5) : HEALTH));
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 75 })).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
      expect(requests).toBe(1);
    } });
  });

  it("does not restart the total deadline when headers or body chunks arrive", async () => {
    let headersWritten = false;
    await withHttpServer({ handle: (_request, response, later) => {
      later(100, () => {
        headersWritten = true;
        response.writeHead(200);
        response.write(HEALTH.slice(0, 5));
        later(250, () => response.end(HEALTH.slice(5)));
      });
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 300 })).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
      expect(headersWritten).toBe(true);
    } });
  });

  it.each(["headers", "body"])("honors explicit caller cancellation during %s", async (phase) => {
    const controller = new AbortController();
    let requests = 0;
    await withHttpServer({ handle: (_request, response, later) => {
      requests++;
      if (phase === "body") { response.writeHead(200); response.write(HEALTH.slice(0, 5)); }
      later(25, () => controller.abort());
      later(300, () => response.end(HEALTH));
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 1_000, signal: controller.signal }))
        .rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" });
      expect(requests).toBe(1);
    } });
  });

  it("refuses pre-cancelled requests and unrepresentable timer budgets before dispatch", async () => {
    let requests = 0;
    await withHttpServer({ handle: (_request, response) => { requests++; response.end(HEALTH); }, run: async (endpoint) => {
      const controller = new AbortController(); controller.abort();
      await expect(client(endpoint).health({ timeoutMs: 1_000, signal: controller.signal }))
        .rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" });
      for (const timeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, 2_147_483_648]) {
        await expect(client(endpoint).health({ timeoutMs })).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
      }
      expect(requests).toBe(0);
    } });
  });

  it("does not follow redirects or forward authorization to their destination", async () => {
    let destinationRequests = 0;
    await withHttpServer({ handle: (_request, response) => { destinationRequests++; response.end(HEALTH); },
      run: async (destination) => withHttpServer({ handle: (_request, response) => {
        response.writeHead(302, { location: `${destination}/health` }); response.end();
      }, run: async (endpoint) => {
        await expect(client(endpoint).health({ timeoutMs: 1_000 })).rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE" });
        expect(destinationRequests).toBe(0);
      } }) });
  });

  it.each([401, 403, 500, 503])("keeps status classification and redacts sensitive bodies/headers (%i)", async (status) => {
    const sentinel = "private-provider-body-and-header";
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(status, { "x-private-provider": sentinel });
      response.end(JSON.stringify({ detail: `${sentinel}:${KEY}` }));
    }, run: async (endpoint) => {
      const error: unknown = await client(endpoint).health({ timeoutMs: 1_000 }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code: status < 500 ? "HINDSIGHT_AUTHENTICATION_FAILED" : "HINDSIGHT_UNREACHABLE" });
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    } });
  });

  it("keeps endpoint-specific structured 503 responses available to the protocol parser", async () => {
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(503); response.end(JSON.stringify({ error: "cutover_verification_refused", reason: "native_failure" }));
    }, run: async (endpoint) => {
      await expect(client(endpoint).currentVerification?.({ bankId: "bank",
        operationId: "11111111-1111-4111-8111-111111111111", providerLineage: "22222222-2222-4222-8222-222222222222",
        bankGeneration: "33333333-3333-4333-8333-333333333333", context: { timeoutMs: 1_000 } }))
        .resolves.toEqual({ error: "cutover_verification_refused", reason: "native_failure" });
    } });
  });

  it.each(["malformed", "oversized", "truncated"])("rejects %s responses without exposing provider content", async (mode) => {
    await withHttpServer({ handle: (_request, response, later) => {
      if (mode === "malformed") response.end("private-response-not-json");
      else if (mode === "oversized") response.end(" ".repeat(512 * 1024 + 1));
      else {
        response.writeHead(200, { "content-length": HEALTH.length + 100 });
        response.write(HEALTH.slice(0, 5)); later(20, () => response.destroy());
      }
    }, run: async (endpoint) => {
      const error: unknown = await client(endpoint).health({ timeoutMs: 1_000 }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code: mode === "truncated" ? "HINDSIGHT_UNREACHABLE" : "HINDSIGHT_RESPONSE_INVALID" });
      expect(String(error)).not.toContain("private-response");
    } });
  });

  it("preserves UTF-8 split across response chunks", async () => {
    const text = "中文😀";
    const bytes = Buffer.from(JSON.stringify({ version: "1", directives: [{ name: "test", content: text }] }));
    const split = bytes.indexOf(Buffer.from("😀")) + 1;
    await withHttpServer({ handle: (_request, response, later) => {
      response.writeHead(200); response.write(bytes.subarray(0, split)); later(20, () => response.end(bytes.subarray(split)));
    }, run: async (endpoint) => {
      await expect(client(endpoint).exportTemplate("bank", { timeoutMs: 1_000 }))
        .resolves.toMatchObject({ directives: [{ content: text }] });
    } });
  });

  it.each(["gzip", "x-gzip", "deflate", "br", "gzip, br"])("decodes %s without changing JSON/UTF-8 values", async (encoding) => {
    const body = JSON.stringify({ version: "1", directives: [{ name: "test", content: "中文😀" }] });
    let encoded = Buffer.from(body);
    for (const name of encoding.split(", ")) {
      encoded = name === "br" ? brotliCompressSync(encoded) : name === "deflate" ? deflateSync(encoded) : gzipSync(encoded);
    }
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(200, { "content-encoding": encoding, "content-length": encoded.byteLength });
      response.end(encoded);
    }, run: async (endpoint) => {
      await expect(client(endpoint).exportTemplate("bank", { timeoutMs: 1_000 }))
        .resolves.toMatchObject({ directives: [{ content: "中文😀" }] });
    } });
  });

  it("bounds decompressed bytes rather than the much smaller compressed content-length", async () => {
    const encoded = gzipSync(" ".repeat(512 * 1024 + 1));
    expect(encoded.byteLength).toBeLessThan(1_000);
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip", "content-length": encoded.byteLength }); response.end(encoded);
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 1_000 })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    } });
  });

  it.each(["deadline", "caller"])("keeps the same %s active while reading compressed content", async (source) => {
    const controller = new AbortController();
    const encoded = gzipSync(HEALTH);
    let requests = 0;
    await withHttpServer({ handle: (_request, response, later) => {
      requests++;
      response.writeHead(200, { "content-encoding": "gzip" }); response.write(encoded.subarray(0, 10));
      if (source === "caller") later(25, () => controller.abort());
      later(300, () => response.end(encoded.subarray(10)));
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: source === "deadline" ? 75 : 1_000, signal: controller.signal }))
        .rejects.toMatchObject({ code: source === "deadline" ? "HINDSIGHT_TIMEOUT" : "HINDSIGHT_CANCELLED" });
      expect(requests).toBe(1);
    } });
  });

  it.each(["unknown", "gzip", "x-gzip", "deflate", "br"])("rejects unsupported or corrupt content encoding (%s) without exposing input", async (encoding) => {
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(200, { "content-encoding": encoding }); response.end("private-corrupt-compressed-content");
    }, run: async (endpoint) => {
      const error: unknown = await client(endpoint).health({ timeoutMs: 1_000 }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      expect(JSON.stringify(error)).not.toContain("private-corrupt");
    } });
  });

  it("rejects a second native Brotli format-error class as an invalid response", async () => {
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(200, { "content-encoding": "br" }); response.end("{}");
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 1_000 })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    } });
  });

  it.each(TRUNCATED_RESPONSES)("distinguishes truncated $encoding $mode failures without replay", async ({ encoding, mode }) => {
    const encoded = encoding === "br" ? brotliCompressSync(HEALTH) : encoding === "deflate" ? deflateSync(HEALTH) : gzipSync(HEALTH);
    let requests = 0;
    await withHttpServer({ handle: (_request, response, later) => {
      requests++;
      response.writeHead(200, { "content-encoding": encoding, "content-length": mode === "representation" ? 10 : encoded.byteLength });
      response.write(encoded.subarray(0, 10));
      if (mode === "representation") response.end();
      else later(20, () => response.destroy());
    }, run: async (endpoint) => {
      await expect(client(endpoint).health({ timeoutMs: 1_000 }))
        .rejects.toMatchObject({ code: mode === "representation" ? "HINDSIGHT_RESPONSE_INVALID" : "HINDSIGHT_UNREACHABLE" });
      expect(requests).toBe(1);
    } });
  });

  it("preserves the finite custom byte budget at its exact UTF-8 boundary and releases abort listeners", async () => {
    const body = JSON.stringify({ value: "中文😀" });
    const size = Buffer.byteLength(body, "utf8");
    await withHttpServer({ handle: (_request, response) => response.end(body), run: async (endpoint) => {
      for (const maxBytes of [size, size - 1]) {
        const signal = AbortSignal.timeout(1_000);
        const call = hindsightHttpTransport(endpoint, { signal }, { maxBytes });
        if (maxBytes === size) await expect(call).resolves.toMatchObject({ body });
        else await expect(call).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
        // Node removes stream bindings when its asynchronous close notification runs, after request settlement.
        await vi.waitFor(() => expect(getEventListeners(signal, "abort")).toEqual([]), { timeout: 1_000, interval: 10 });
      }
    } });
  });

  it.each([204, 205])("preserves an empty %i response even if it advertises compression", async (status) => {
    await withHttpServer({ handle: (_request, response) => {
      response.writeHead(status, { "content-encoding": "gzip", "content-length": "0" }); response.end();
    }, run: async (endpoint) => {
      await expect(hindsightHttpTransport(endpoint, { signal: AbortSignal.timeout(1_000) })).resolves.toMatchObject({ status, body: "" });
    } });
  });

  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("sends one supported JSON %s request with exact UTF-8 content", async (method) => {
    const body = ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify({ value: "中文😀" });
    let requests = 0;
    await withHttpServer({ handle: (request, response) => {
      requests++;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        expect(request.method).toBe(method);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(body ?? "");
        response.writeHead(200, { "content-encoding": "gzip" }); response.end(gzipSync(HEALTH));
      });
    }, run: async (endpoint) => {
      await expect(hindsightHttpTransport(endpoint, { method, body, signal: AbortSignal.timeout(1_000),
        headers: { "content-length": String(Buffer.byteLength(body ?? "", "utf8")) } }))
        .resolves.toMatchObject({ body: method === "HEAD" ? "" : HEALTH });
      expect(requests).toBe(1);
    } });
  });

  it("refuses unsupported request semantics and invalid bounds before dispatch", async () => {
    let requests = 0;
    await withHttpServer({ handle: (_request, response) => { requests++; response.end(HEALTH); }, run: async (endpoint) => {
      await expect(hindsightHttpTransport(endpoint)).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
      for (const invalid of [{ method: "TRACE" }, { method: 7 }, { body: "{}" }, { method: "HEAD", body: "{}" },
        { method: "POST", body: new Uint8Array(1) }, { redirect: "follow" }, { cache: "no-store" },
        { headers: { "bad\nheader": "x" } }, { headers: { expect: "100-continue" } },
        { headers: { "transfer-encoding": "chunked" } }, { headers: { upgrade: "websocket" } },
        { method: "POST", body: "中", headers: { "content-length": "1" } }]) {
        await expect(hindsightHttpTransport(endpoint, { ...invalid, signal: AbortSignal.timeout(1_000) } as RequestInit))
          .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      }
      for (const maxBytes of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(hindsightHttpTransport(endpoint, { signal: AbortSignal.timeout(1_000) }, { maxBytes }))
          .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      }
      for (const url of ["file:///owned-invalid", `${endpoint}/#fragment`, endpoint.replace("://", "://user:password@"), "not-a-url"]) {
        await expect(hindsightHttpTransport(url, { signal: AbortSignal.timeout(1_000) }))
          .rejects.toMatchObject({ code: "HINDSIGHT_ENDPOINT_REJECTED" });
      }
      expect(requests).toBe(0);
    } });
  });

  it("requires normal TLS certificate verification before sending credentials or JSON", async () => {
    let requests = 0;
    await withHttpServer({ tls: true, handle: (_request, response) => { requests++; response.end(HEALTH); }, run: async (endpoint) => {
      await expect(hindsightHttpTransport(endpoint, { signal: AbortSignal.timeout(1_000) }))
        .rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
      await expect(client(endpoint).health({ timeoutMs: 1_000 })).rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE" });
      expect(requests).toBe(0);
    } });
  });

  it("does not replay an accepted mutation after a deadline; an explicit GET recovers its same identity", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    let posts = 0; let reads = 0;
    await withHttpServer({ handle: (request, response, later) => {
      if (request.method === "POST") {
        posts++;
        request.resume();
        later(250, () => response.end(JSON.stringify({ success: true, bank_id: "bank", items_count: 1, async: true, operation_id: operationId })));
      } else {
        reads++;
        expect(request.url).toContain(operationId);
        response.end(JSON.stringify({ operation_id: operationId, status: "completed",
          result_metadata: { unit_ids_count: 1, extraction_errors_count: 0 } }));
      }
    }, run: async (endpoint) => {
      const subject = client(endpoint);
      await expect(subject.retainImport?.({ bankId: "bank", content: "owned-loopback-input", documentId: "doc", operationId,
        context: null, call: { timeoutMs: 75 } })).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
      await expect(subject.operationImportStatus?.("bank", operationId, { timeoutMs: 1_000 }))
        .resolves.toMatchObject({ operationId, status: "completed", derivedUnitCount: 1 });
      await nextTurn();
      expect({ posts, reads }).toEqual({ posts: 1, reads: 1 });
    } });
  });

  it("does not retry socket resets or failed connections", async () => {
    let requests = 0; let closedEndpoint = "";
    await withHttpServer({ handle: (request) => { requests++; request.socket.destroy(); }, run: async (endpoint) => {
      closedEndpoint = endpoint;
      await expect(client(endpoint).health({ timeoutMs: 1_000 })).rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE" });
      expect(requests).toBe(1);
    } });
    await expect(client(closedEndpoint).health({ timeoutMs: 1_000 })).rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE" });
    expect(requests).toBe(1);
  });
});
