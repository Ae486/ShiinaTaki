import { once } from "node:events";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startAgentContextTimingRelay } from "./agent-context-timing-relay.ts";

function evidenceDir() {
  const root = process.env.TAKI_E2E_EVIDENCE_DIR ?? tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "timing-relay-"));
}

describe("agent context timing relay evidence and transparent transport", () => {
  it("holds actual HTTP before forwarding, preserves successful bytes and cancels a held request without an upstream attempt", async () => {
    const bodies: string[] = [];
    const payload = 'data: {"choices":[{"delta":{"content":"真实 unchanged"}}]}\n\ndata: [DONE]\n\n';
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "text/event-stream" }); response.end(payload);
    });
    upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("test upstream did not bind");
    const relay = await startAgentContextTimingRelay({ baseUrl: `http://127.0.0.1:${address.port}/v1`, evidenceDir: evidenceDir(),
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
