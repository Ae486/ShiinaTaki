/**
 * INPUT: existing method/connection registries, desired bind address and authenticated endpoint publication
 * OUTPUT: serialized listener replacement that preserves the last usable endpoint on preparation failure
 * POS: core/server — owns listeners only; accepted Run/Memory and per-socket cleanup remain with existing owners
 */
import { setImmediate } from "node:timers/promises";
import { startWsServer, type WsServer, type WsServerOptions } from "./ws-server.ts";

export interface ListenerAddress { host: string; port: number }
export interface WsListenerOptions extends WsServerOptions {
  publishEndpoint(endpoint: string): void;
}

export function wsEndpoint(address: ListenerAddress): string {
  const host = address.host.includes(":") && !address.host.startsWith("[") ? `[${address.host}]` : address.host;
  return `ws://${host}:${address.port}`;
}

export async function startWsListener(options: WsListenerOptions) {
  let server = await prepare(options, options);
  let address = { host: options.host, port: server.port };
  let closing = false;
  let tail: Promise<void> = Promise.resolve();
  const replace = (next: ListenerAddress): Promise<void> => {
    const requested = { ...next };
    const operation = tail.then(async () => {
      if (closing) throw new Error("LISTENER_CLOSED");
      if (requested.host === address.host && requested.port === address.port) return;
      // The config RPC may be served by the retiring listener; let its response flush before replacement.
      await setImmediate();
      if (closing) throw new Error("LISTENER_CLOSED");
      const candidate = await prepare(options, requested);
      if (closing) { await candidate.close(); throw new Error("LISTENER_CLOSED"); }
      const previous = server;
      server = candidate;
      address = { host: requested.host, port: candidate.port };
      await previous.close();
    });
    // Failure is observable to this caller without poisoning the subsequent replacement/close chain.
    tail = operation.catch(() => {});
    return operation;
  };
  return {
    address: (): ListenerAddress => ({ ...address }),
    replace,
    async close(): Promise<void> {
      closing = true;
      await tail;
      await server.close();
    },
  };
}

async function prepare(options: WsListenerOptions, address: ListenerAddress): Promise<WsServer> {
  const candidate = await startWsServer({ ...options, ...address });
  try { options.publishEndpoint(wsEndpoint({ host: address.host, port: candidate.port })); }
  catch (error) { await candidate.close(); throw error; }
  return candidate;
}
