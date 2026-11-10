/**
 * INPUT: approved upstream endpoint, explicit gates, optional concurrency bound and isolated evidence
 * OUTPUT: unchanged HTTP bodies/streams with recorded waiting, forwarding, concurrency and abort facts
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
  queuedAt: string | null;
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
  maxConcurrentRequests?: number;
}) {
  if (input.maxConcurrentRequests !== undefined
    && (!Number.isSafeInteger(input.maxConcurrentRequests) || input.maxConcurrentRequests < 1)) {
    throw new Error("timing relay concurrency must be a positive safe integer");
  }
  const limit = input.maxConcurrentRequests ?? Number.POSITIVE_INFINITY;
  const slotWaiters: Array<() => void> = [];
  let inFlight = 0;
  let peak = 0;
  const concurrency = () => ({ limit: input.maxConcurrentRequests ?? null, inFlight, peak, queued: slotWaiters.length });
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
        concurrency: concurrency(),
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
    let ownsSlot = false;
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
        gate: gate ?? null, heldAt: null, releasedAt: null, queuedAt: null, forwardedAt: null, finishedAt: null,
        status: null, aborted: null, failure: null };
      requests.push(observed);
      if (gate && !released.has(gate)) {
        observed.heldAt = new Date().toISOString(); save();
        await waitForRelease(gate, controller.signal);
        observed.releasedAt = new Date().toISOString();
      }
      // Explicitly held requests must not occupy the slot needed by the work that releases their gate.
      await acquireSlot(controller.signal, observed);
      ownsSlot = true;
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
      if (ownsSlot) {
        inFlight -= 1;
        while (slotWaiters.length > 0 && inFlight < limit) slotWaiters.shift()?.();
      }
      if (observed) observed.finishedAt = new Date().toISOString();
      save();
    }
  }
  async function acquireSlot(signal: AbortSignal, observed: TimingRequest): Promise<void> {
    signal.throwIfAborted();
    if (inFlight < limit) { inFlight += 1; peak = Math.max(peak, inFlight); return; }
    observed.queuedAt = new Date().toISOString(); save();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) { reject(new Error("queued request aborted")); return; }
        inFlight += 1; peak = Math.max(peak, inFlight); resolve();
      };
      const onAbort = () => {
        const index = slotWaiters.indexOf(start);
        if (index >= 0) slotWaiters.splice(index, 1);
        reject(new Error("queued request aborted"));
      };
      slotWaiters.push(start);
      signal.addEventListener("abort", onAbort, { once: true });
    });
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
    baseUrl: `http://127.0.0.1:${port}/v1`, requests, concurrency,
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
