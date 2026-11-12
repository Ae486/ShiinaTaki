/**
 * INPUT: current paired Node reports and authenticated operator snapshot reads
 * OUTPUT: browser.playback methods with socket-derived provenance and strict privacy/identity admission
 * POS: core/server/methods — no browser credential, operator privilege or acceptance is created by a report
 */
import { BROWSER_PLAYBACK_METHODS, BrowserPlaybackReportSchema, BrowserPlaybackReadParamsSchema,
  BrowserPlaybackReadyParamsSchema, type BrowserPlaybackControl } from "@taki/shared";
import type { BrowserPlaybackSources } from "../../perception/browser-playback-sources.ts";
import type { HostCatalogStore } from "../../hosts/host-catalog.ts";
import type { Connection, ConnectionRegistry } from "../connection-registry.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";

interface Dependencies {
  sources: BrowserPlaybackSources; connections: ConnectionRegistry; catalogs: HostCatalogStore;
}

function readControl(input: Dependencies, peers: Map<Connection, BrowserPlaybackControl>, connection: Connection): BrowserPlaybackControl {
  const auth = connection.state;
  if (auth.status !== "authenticated" || auth.role !== "node" || !auth.host
    || !input.connections.isCurrentHost(connection)) throw appException("FORBIDDEN", "A current paired Host is required");
  const catalog = input.catalogs.get(auth.host.hostId);
  if (!catalog || catalog.connectionGeneration !== auth.host.connectionGeneration) {
    throw appException("FORBIDDEN", "A current Host catalog is required");
  }
  return { schemaVersion: "taki.browser-playback-control.v1", hostId: auth.host.hostId,
    connectionGeneration: auth.host.connectionGeneration, catalogGeneration: catalog.catalogGeneration,
    revision: (peers.get(connection)?.revision ?? 0) + 1,
    enabled: input.sources.read().enabled && catalog.readiness === "ready" };
}

export function registerBrowserPlaybackMethods(registry: MethodRegistry, input: Dependencies): { refresh(): void; close(): void } {
  const peers = new Map<Connection, BrowserPlaybackControl>();
  input.connections.onRemove((connection) => peers.delete(connection));
  const control = (connection: Connection) => readControl(input, peers, connection);
  registry.register({ method: BROWSER_PLAYBACK_METHODS.ready, roles: ["node"], paramsSchema: BrowserPlaybackReadyParamsSchema,
    handler(_params, ctx) { const value = control(ctx.connection); peers.set(ctx.connection, value); return value; },
  });
  registry.register({ method: BROWSER_PLAYBACK_METHODS.report, roles: ["node"], paramsSchema: BrowserPlaybackReportSchema,
    handler: (params, ctx) => peers.has(ctx.connection)
      ? input.sources.report(ctx.connection, params) : { accepted: false, reason: "wrong_host" },
    onInvalidParams: (_params, ctx) => {
      // Do not delete the generation tombstone on a malformed frame: the next old sample must remain refused.
      input.sources.report(ctx.connection, undefined);
    },
  });
  registry.register({ method: BROWSER_PLAYBACK_METHODS.read, roles: ["operator"], paramsSchema: BrowserPlaybackReadParamsSchema,
    handler(_params, ctx) {
      const state = ctx.connection.state;
      if (state.status !== "authenticated" || state.role !== "operator" || !input.connections.list().includes(ctx.connection)) {
        throw appException("FORBIDDEN", "A live operator connection is required");
      }
      return input.sources.read();
    },
  });
  return {
    refresh() {
      for (const [connection, previous] of peers) {
        try {
          const next = control(connection);
          if (next.enabled === previous.enabled && next.catalogGeneration === previous.catalogGeneration) continue;
          peers.set(connection, next);
          connection.notify?.(BROWSER_PLAYBACK_METHODS.control, next);
        } catch {
          peers.delete(connection);
          input.sources.report(connection, undefined);
        }
      }
    },
    close() { peers.clear(); },
  };
}
