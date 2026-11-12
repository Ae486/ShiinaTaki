import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startAgentContextTimingRelay } from "./agent-context-timing-relay.ts";
import { listenLoopbackHttp } from "./loopback-http.ts";

function evidenceDir() {
  const root = process.env.TAKI_E2E_EVIDENCE_DIR ?? tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "timing-relay-"));
}

describe("agent context timing relay evidence and transparent transport", () => {
  it("limits upstream concurrency and cancels queued requests without forwarding or blocking their successor", async () => {
    const received: string[] = [];
    const responses = new Map<string, ServerResponse>();
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      received.push(body); responses.set(body, response);
    });
    const port = await listenLoopbackHttp(upstream);
    const relay = await startAgentContextTimingRelay({ baseUrl: `http://127.0.0.1:${port}/v1`,
      evidenceDir: evidenceDir(), gate: () => undefined, maxConcurrentRequests: 1 });
    const send = (body: string, signal?: AbortSignal) => fetch(`${relay.baseUrl}/chat/completions`,
      { method: "POST", body, signal }).then((response) => response.text(), () => "cancelled");
    const first = send('{"request":1}');
    const cancelledController = new AbortController();
    try {
      await expect.poll(() => received.length).toBe(1);
      const cancelled = send('{"request":2}', cancelledController.signal);
      await expect.poll(() => relay.requests.length).toBe(2);
      const third = send('{"request":3}');
      await expect.poll(() => relay.requests.length).toBe(3);
      expect(received).toEqual(['{"request":1}']);
      expect(relay.requests[1]?.forwardedAt).toBeNull();
      cancelledController.abort(); expect(await cancelled).toBe("cancelled");
      await expect.poll(() => relay.requests[1]?.finishedAt).toBeTruthy();
      responses.get('{"request":1}')!.end("first unchanged");
      expect(await first).toBe("first unchanged");
      await expect.poll(() => received.length).toBe(2);
      expect(received[1]).toBe('{"request":3}');
      responses.get('{"request":3}')!.end("third unchanged");
      expect(await third).toBe("third unchanged");
      expect(relay.requests[1]).toMatchObject({ forwardedAt: null, aborted: "client-closed" });
      expect(relay.concurrency()).toMatchObject({ limit: 1, peak: 1, queued: 0 });
    } finally {
      cancelledController.abort();
      await relay.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await first;
    }
  });

  it("does not let an explicitly held request consume the sole upstream slot", async () => {
    const received: string[] = [];
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8"); received.push(body); response.end(body);
    });
    const port = await listenLoopbackHttp(upstream);
    const relay = await startAgentContextTimingRelay({ baseUrl: `http://127.0.0.1:${port}/v1`,
      evidenceDir: evidenceDir(), gate: (body) => body.held ? "held" : undefined, maxConcurrentRequests: 1 });
    const held = fetch(`${relay.baseUrl}/chat/completions`, { method: "POST", body: '{"held":true}' })
      .then((response) => response.text(), () => "cancelled");
    try {
      await expect.poll(() => relay.requests[0]?.heldAt).toBeTruthy();
      const free = await fetch(`${relay.baseUrl}/chat/completions`, { method: "POST", body: '{"free":true}' });
      expect(await free.text()).toBe('{"free":true}');
      expect(received).toEqual(['{"free":true}']);
      relay.release("held");
      expect(await held).toBe('{"held":true}');
      expect(relay.concurrency().peak).toBe(1);
    } finally {
      await relay.close(); upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await held;
    }
  });

  it("holds actual HTTP before forwarding, preserves successful bytes and cancels a held request without an upstream attempt", async () => {
    const bodies: string[] = [];
    const payload = 'data: {"choices":[{"delta":{"content":"真实 unchanged"}}]}\n\ndata: [DONE]\n\n';
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "text/event-stream" }); response.end(payload);
    });
    const port = await listenLoopbackHttp(upstream);
    const relay = await startAgentContextTimingRelay({ baseUrl: `http://127.0.0.1:${port}/v1`, evidenceDir: evidenceDir(),
      gate: (body) => String(body.gate) });
    const body = '{ "gate" : "release", "messages": [] }';
    try {
      const response = fetch(`${relay.baseUrl}/chat/completions`, { method: "POST", body });
      await expect.poll(() => relay.requests[0]?.heldAt).toBeTruthy();
      expect(bodies).toEqual([]); expect(relay.requests[0]?.forwardedAt).toBeNull();
      relay.release("release");
      expect(await (await response).text()).toBe(payload);
      expect(bodies).toEqual([body]);
      const controller = new AbortController();
      const cancelled = fetch(`${relay.baseUrl}/chat/completions`, { method: "POST", body: '{"gate":"cancel"}', signal: controller.signal })
        .then(() => "unexpected-success", () => "cancelled");
      await expect.poll(() => relay.requests[1]?.heldAt).toBeTruthy();
      controller.abort(); expect(await cancelled).toBe("cancelled");
      await expect.poll(() => relay.requests[1]?.finishedAt).toBeTruthy();
      expect(relay.requests[1]).toMatchObject({ aborted: "client-closed", forwardedAt: null });
      expect(bodies).toHaveLength(1);
    } finally {
      await relay.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("fails final acceptance after an evidence write failure and still closes its listening socket", async () => {
    const directory = evidenceDir();
    const relay = await startAgentContextTimingRelay({ baseUrl: "http://127.0.0.1:9/v1", evidenceDir: directory, gate: () => undefined });
    const artifact = join(directory, "transport.json");
    // This is this test's exact generated file; replace it with an owned obstruction to exercise real filesystem failure.
    unlinkSync(artifact); mkdirSync(artifact);
    await expect(fetch(`${relay.baseUrl}/chat/completions`, { method: "POST", body: '{"messages":[]}' })).rejects.toThrow();
    expect(relay.requests[0]?.forwardedAt).toBeNull();
    await expect(relay.close()).rejects.toThrow("timing relay evidence write failed");
    await expect(fetch(`${relay.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).rejects.toThrow();
  });

  it("refuses initial evidence failure before binding a socket", async () => {
    const invalidDirectory = join(evidenceDir(), "regular-file");
    writeFileSync(invalidDirectory, "owned test obstruction", "utf8");
    const listen = vi.spyOn(Server.prototype, "listen");
    try {
      await expect(startAgentContextTimingRelay({ baseUrl: "http://127.0.0.1:9/v1", evidenceDir: invalidDirectory,
        gate: () => undefined })).rejects.toThrow("timing relay evidence write failed");
      expect(listen).not.toHaveBeenCalled();
    } finally { listen.mockRestore(); }
  });
});
