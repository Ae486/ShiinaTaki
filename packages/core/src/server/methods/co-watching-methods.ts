/**
 * INPUT: authenticated operator requests and the Co-Watching runtime/configuration owners
 * OUTPUT: validated control/catalog RPCs and opt-in, data-free Character invalidation
 * POS: core/server/methods — a browser Node or copied connection object cannot grant acceptance
 */
import { z, type ZodType } from "zod";
import { CO_WATCHING_METHODS, CoWatchingReadParamsSchema, CoWatchingStartSchema, CoWatchingStopSchema,
  CoWatchingReviseSchema, CoWatchingSubscribeSchema, CoWatchingRegisterSchema, CoWatchingRemoveSchema,
  CO_WATCHING_INVITATION_METHODS, CoWatchingInvitationReadParamsSchema, CoWatchingInvitationRespondSchema } from "@taki/shared";
import type { CoWatchingRuntime } from "../../co-watching/runtime.ts";
import type { ViewingInvitationSource } from "../../co-watching/viewing-invitation-source.ts";
import type { CoWatchingCatalog } from "../../co-watching/analysis-catalog.ts";
import type { Connection, ConnectionRegistry } from "../connection-registry.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";

export function createCoWatchingSubscriptions() {
  const peers = new Map<Connection, { characters: Set<string>; notify: MethodContext["notify"] }>();
  // A replacement Core socket resets the client's observation owner for this producer lifetime.
  let revision = 0;
  return {
    subscribe(characterId: string, ctx: MethodContext) {
      let peer = peers.get(ctx.connection);
      if (!peer) {
        peer = { characters: new Set(), notify: ctx.notify }; peers.set(ctx.connection, peer);
        ctx.onClose(() => peers.delete(ctx.connection));
      }
      if (peer.characters.size >= 64 && !peer.characters.has(characterId)) throw appException("FORBIDDEN", "Too many Character subscriptions");
      peer.characters.add(characterId);
    },
    publish(characterId: string) {
      revision += 1;
      for (const [connection, peer] of peers) {
        if (connection.state.status !== "authenticated" || connection.state.role !== "operator") { peers.delete(connection); continue; }
        try {
          for (const character of peer.characters) if (characterId === "*" || character === characterId) {
            peer.notify(CO_WATCHING_METHODS.changed, { characterId: character, revision });
          }
        } catch { peers.delete(connection); }
      }
    },
    close() { peers.clear(); },
  };
}

export function registerCoWatchingMethods(registry: MethodRegistry, input: {
  runtime: CoWatchingRuntime; catalog: CoWatchingCatalog; connections: ConnectionRegistry;
  subscriptions: ReturnType<typeof createCoWatchingSubscriptions>;
  invitations?: ViewingInvitationSource;
}): void {
  const add = <P>(method: string, schema: ZodType<P>, action: (params: P, ctx: MethodContext) => unknown) => {
    registry.register({ method, roles: ["operator"], paramsSchema: schema, handler(params, ctx) {
      if (ctx.connection.state.status !== "authenticated" || ctx.connection.state.role !== "operator"
        || !input.connections.list().includes(ctx.connection)) throw appException("FORBIDDEN", "A live operator connection is required");
      try { return action(params, ctx); }
      catch (error) {
        if (error instanceof Error && error.message === "CO_WATCHING_CATALOG_CONFLICT") {
          throw appException("CONFIG_REFUSED", "Co-Watching configuration changed; refresh before trying again", { reason: "catalog_conflict" });
        }
        throw appException("INTERNAL_ERROR", "Co-Watching operation could not be completed");
      }
    } });
  };
  add(CO_WATCHING_METHODS.read, CoWatchingReadParamsSchema, (params) => input.runtime.read(params.characterId));
  add(CO_WATCHING_INVITATION_METHODS.read, CoWatchingInvitationReadParamsSchema,
    (params) => input.invitations?.read(params.characterId) ?? { characterId: params.characterId, invitation: null });
  add(CO_WATCHING_INVITATION_METHODS.respond, CoWatchingInvitationRespondSchema,
    (params, ctx) => input.invitations?.respond(params, { connection: ctx.connection }) ?? { status: "refused", reason: "unavailable" });
  add(CO_WATCHING_METHODS.start, CoWatchingStartSchema, (params, ctx) => input.runtime.start(params, { connection: ctx.connection }));
  add(CO_WATCHING_METHODS.stop, CoWatchingStopSchema, (params) => input.runtime.stop(params.characterId, params.sessionId));
  add(CO_WATCHING_METHODS.revise, CoWatchingReviseSchema, (params) => input.runtime.revise(params));
  add(CO_WATCHING_METHODS.subscribe, CoWatchingSubscribeSchema, (params, ctx) => {
    input.subscriptions.subscribe(params.characterId, ctx); return { ok: true };
  });
  add(CO_WATCHING_METHODS.catalog, z.strictObject({}), () => ({ entries: input.catalog.list() }));
  add(CO_WATCHING_METHODS.register, CoWatchingRegisterSchema, (params) => {
    const analysis = input.catalog.register(params); input.runtime.playbackChanged(); input.subscriptions.publish("*");
    return { analysis };
  });
  add(CO_WATCHING_METHODS.remove, CoWatchingRemoveSchema, (params) => {
    input.catalog.remove(params.analysisId, params.expectedRevision); input.runtime.playbackChanged(); input.subscriptions.publish("*");
    return { removed: true };
  });
}
