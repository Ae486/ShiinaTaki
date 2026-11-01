/**
 * INPUT: approved upstream endpoint, explicit request gates and an isolated evidence directory
 * OUTPUT: unchanged HTTP bodies/streams with recorded hold, release, forward and abort facts
 * POS: e2e/fixture — deterministic timing only; no fabricated successful response or Core lifecycle mutation
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { listenLoopbackHttp } from "./loopback-http.ts";

export interface TimingRequest {
  requestNumber: number;
  bodySha256: string;
  gate: string | null;
  heldAt: string | null;
  releasedAt: string | null;
  forwardedAt: string | null;
  finishedAt: string | null;
  status: number | null;
  aborted: "client-closed" | "relay-closed" | "deadline" | null;
  failure: "transport-failed" | null;
}

export async function startAgentContextTimingRelay(input: {
  baseUrl: string;
  evidenceDir: string;
  gate(body: Record<string, unknown>): string | undefined;
}) {
  const requests: TimingRequest[] = [];
  const released = new Set<string>();
  const active = new Map<AbortController, () => void>();
  const pending = new Map<string, Set<() => void>>();
  const operations = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  let evidenceFailed = false;
  const save = () => {
    try {
      writeFileSync(join(input.evidenceDir, "transport.json"), `${JSON.stringify({
        kind: "transparent-request-hold-relay", requests,
        physicalUpstreamAttempts: requests.filter((item) => item.forwardedAt !== null).length,
        active: active.size, closed: closing !== undefined,
      }, null, 2)}\n`, "utf8");
    } catch {
      evidenceFailed = true;
      throw new Error("timing relay evidence write failed");
    }
  };
  const server = createServer((request, response) => {
    const operation = forward(request, response);
    operations.add(operation);
    void operation.then(() => operations.delete(operation), () => operations.delete(operation));
  });
  async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404); response.end(); return;
    }
    const controller = new AbortController();
    let observed: TimingRequest | undefined;
    const abort = (reason: NonNullable<TimingRequest["aborted"]>) => {
      if (controller.signal.aborted) return;
      if (observed) observed.aborted = reason;
      controller.abort();
    };
    const onClose = () => { if (!response.writableEnded) abort("client-closed"); };
    response.on("close", onClose);
    active.set(controller, () => abort("relay-closed"));
    const timer = setTimeout(() => abort("deadline"), 180_000);
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid timing request");
      const gate = input.gate(parsed as Record<string, unknown>);
      observed = { requestNumber: requests.length + 1, bodySha256: createHash("sha256").update(body).digest("hex"),
        gate: gate ?? null, heldAt: null, releasedAt: null, forwardedAt: null, finishedAt: null,
        status: null, aborted: null, failure: null };
      requests.push(observed);
      if (gate && !released.has(gate)) {
        observed.heldAt = new Date().toISOString(); save();
        await waitForRelease(gate, controller.signal);
        observed.releasedAt = new Date().toISOString();
      }
      controller.signal.throwIfAborted();
      save();
      observed.forwardedAt = new Date().toISOString();
      const upstream = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: request.headers.authorization ?? "" },
        body, signal: controller.signal, redirect: "error",
      });
      observed.status = upstream.status; save();
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      if (upstream.body) for await (const chunk of upstream.body) {
        if (!response.write(chunk)) await once(response, "drain", { signal: controller.signal });
      }
      response.end();
    } catch {
      if (observed && !observed.aborted) observed.failure = "transport-failed";
      if (!response.destroyed) response.destroy();
    } finally {
      clearTimeout(timer); response.off("close", onClose); active.delete(controller);
      if (observed) observed.finishedAt = new Date().toISOString();
      save();
    }
  }
  async function waitForRelease(gate: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const waiters = pending.get(gate) ?? new Set<() => void>();
      const finish = () => { signal.removeEventListener("abort", onAbort); waiters.delete(finish); resolve(); };
      const onAbort = () => { waiters.delete(finish); reject(new Error("held request aborted")); };
      waiters.add(finish); pending.set(gate, waiters);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  // Fail evidence setup before acquiring a listening socket whose closer has not reached the caller yet.
  save();
  const port = await listenLoopbackHttp(server);
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`, requests,
    release(gate: string) {
      released.add(gate);
      for (const resolve of pending.get(gate) ?? []) resolve();
    },
    close(): Promise<void> {
      closing ??= (async () => {
        const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        for (const abort of active.values()) abort();
        server.closeAllConnections();
        await Promise.allSettled([...operations]);
        await closed;
        save();
        if (evidenceFailed) throw new Error("timing relay evidence write failed");
      })();
      return closing;
    },
  };
}
