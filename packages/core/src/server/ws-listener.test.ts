import { createServer } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger } from "../logging/logger.ts";
import { openClient, type TestClient } from "../testing/ws-test-client.ts";
import { createConnectionRegistry } from "./connection-registry.ts";
import { createMethodRegistry } from "./method-registry.ts";
import { startWsListener, wsEndpoint } from "./ws-listener.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

async function fixture() {
  const registry = createMethodRegistry();
  const connectionRegistry = createConnectionRegistry();
  registry.register({ method: "connect", roles: ["operator"], paramsSchema: z.object({}), handler: () => ({ alive: true }) });
  let rejectPublication = false;
  const published: string[] = [];
  const listener = await startWsListener({ host: "127.0.0.1", port: 0, registry, connectionRegistry, logger: createLogger("fatal"),
    publishEndpoint: (endpoint) => { if (rejectPublication) throw new Error("disk full"); published.push(endpoint); } });
  cleanup.push(listener.close);
  return { listener, connectionRegistry, published, refusePublication: () => { rejectPublication = true; } };
}

async function connect(endpoint: string): Promise<TestClient> {
  const client = await openClient(endpoint);
  cleanup.push(client.close);
  client.send({ jsonrpc: "2.0", id: "alive", method: "connect", params: {} });
  expect(await client.take(1)).toEqual([{ jsonrpc: "2.0", id: "alive", result: { alive: true } }]);
  return client;
}

describe("live WS listener replacement", () => {
  it("prepares the real endpoint, retires old sockets and retains one service plane", async () => {
    const { listener, connectionRegistry, published } = await fixture();
    const old = await connect(published[0]!);
    let retired = 0;
    connectionRegistry.onRemove(() => { retired += 1; });
    const closed = old.waitClosed();
    await listener.replace({ host: "127.0.0.1", port: 0 });
    await closed;
    expect(retired).toBe(1);
    expect(published[1]).not.toBe(published[0]);
    await connect(published[1]!);
    expect(published[1]).toBe(wsEndpoint(listener.address()));
  });

  it("retains the serving endpoint and sockets when a candidate cannot bind", async () => {
    const { listener, published } = await fixture();
    const old = await connect(published[0]!);
    const occupied = createServer();
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    cleanup.push(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Missing occupied address");
    await expect(listener.replace({ host: "127.0.0.1", port: address.port })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(published).toHaveLength(1);
    old.send({ jsonrpc: "2.0", id: "still-alive", method: "connect", params: {} });
    expect((await old.take(1))[0]).toMatchObject({ id: "still-alive", result: { alive: true } });
    await listener.replace({ host: "127.0.0.1", port: 0 });
    expect(published).toHaveLength(2);
  });

  it("keeps the old endpoint when publishing discovery fails after binding", async () => {
    const { listener, published, refusePublication } = await fixture();
    refusePublication();
    await expect(listener.replace({ host: "127.0.0.1", port: 0 })).rejects.toThrow("disk full");
    expect(wsEndpoint(listener.address())).toBe(published[0]);
    await connect(published[0]!);
  });

  it("formats IPv6 endpoints as valid URLs", () => {
    expect(wsEndpoint({ host: "::1", port: 8974 })).toBe("ws://[::1]:8974");
  });
});
