import { once } from "node:events";
import { connect, type Socket } from "node:net";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createLogger } from "../logging/logger.ts";
import { createConnectionRegistry } from "./connection-registry.ts";
import { createMethodRegistry } from "./method-registry.ts";
import { startWsServer, type WsServer } from "./ws-server.ts";

let server: WsServer | undefined;
let client: Socket | undefined;
afterEach(async () => {
  client?.destroy();
  await server?.close();
});

it("yields between coalesced requests so a status burst cannot monopolize the event loop", async () => {
  const connections = createConnectionRegistry();
  const registry = createMethodRegistry();
  const events: string[] = [];
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  registry.register({
    method: "connect", roles: ["operator"], paramsSchema: z.object({}),
    handler: (_, context) => {
      connections.authenticate(context.connection, { deviceId: "fixture", role: "operator", capabilities: [] });
      return {};
    },
  });
  registry.register({
    method: "fixture.status", roles: ["operator"], paramsSchema: z.object({ sequence: z.number() }),
    handler: ({ sequence }) => {
      events.push(`status-${sequence}`);
      // Models ready work from another owner without a timing-sensitive CPU spin.
      if (sequence === 1) setImmediate(() => events.push("other-owner"));
      if (sequence === 3) setImmediate(complete);
      return {};
    },
  });
  server = await startWsServer({ host: "127.0.0.1", port: 0, registry,
    connectionRegistry: connections, logger: createLogger("fatal") });
  client = connect(server.port, "127.0.0.1");
  await once(client, "connect");
  const upgraded = once(client, "data");
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
  expect(String((await upgraded)[0])).toContain("101 Switching Protocols");
  // Send a compact burst in one write to exercise coalesced receiver frames.
  client.write(Buffer.concat([
    maskedFrame({ jsonrpc: "2.0", id: 0, method: "connect", params: {} }),
    ...[1, 2, 3].map((sequence) => maskedFrame({ jsonrpc: "2.0", id: sequence,
      method: "fixture.status", params: { sequence } })),
  ]));
  await completed;
  expect(events).toEqual(["status-1", "other-owner", "status-2", "status-3"]);
});

/** Small, masked client frames in one write reproduce ws's coalesced receiver path. */
function maskedFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length >= 126) throw new Error("fixture frame must use the short length encoding");
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]!));
  return Buffer.concat([Buffer.from([0x81, 0x80 | body.length]), mask, masked]);
}
