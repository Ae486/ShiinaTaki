/**
 * INPUT: deadline-bound operator requests and strict Shared Co-Watching contracts
 * OUTPUT: verified read/start/stop methods and retryable Character subscription setup
 * POS: ui/lib — wire facade, without accepted-work authority or mutation replay
 */
import { JSONRPCErrorException, type JSONRPCParams } from "json-rpc-2.0";
import { CO_WATCHING_METHODS, CoWatchingReadResultSchema, CoWatchingControlResultSchema,
  CoWatchingSubscribeResultSchema, JSON_RPC_ERROR_CODES, type CoWatchingStart } from "@taki/shared";
import { CO_WATCHING_INVITATION_METHODS, CoWatchingInvitationReadResultSchema,
  CoWatchingInvitationRespondResultSchema, type CoWatchingInvitationRespond } from "@taki/shared";
import type { ReadSubscriptionSupport } from "./ws-read-subscriptions.ts";

type Request = <T>(method: string, params: JSONRPCParams) => Promise<T>;
export function coWatchingMethods(request: Request) {
  const subscriptions = new Map<string, Promise<ReadSubscriptionSupport>>();
  return {
    coWatchingInvitationRead: async (characterId: string) => CoWatchingInvitationReadResultSchema.parse(
      await request(CO_WATCHING_INVITATION_METHODS.read, { characterId })),
    coWatchingInvitationRespond: async (params: CoWatchingInvitationRespond) => CoWatchingInvitationRespondResultSchema.parse(
      await request(CO_WATCHING_INVITATION_METHODS.respond, params)),
    coWatchingRead: async (characterId: string) =>
      CoWatchingReadResultSchema.parse(await request(CO_WATCHING_METHODS.read, { characterId })),
    coWatchingStart: async (params: CoWatchingStart) =>
      CoWatchingControlResultSchema.parse(await request(CO_WATCHING_METHODS.start, params)),
    coWatchingStop: async (params: { characterId: string; sessionId: string }) =>
      CoWatchingControlResultSchema.parse(await request(CO_WATCHING_METHODS.stop, params)),
    subscribeCoWatching(characterId: string): Promise<ReadSubscriptionSupport> {
      const existing = subscriptions.get(characterId);
      if (existing) return existing;
      const attempt = request(CO_WATCHING_METHODS.subscribe, { characterId }).then((value): ReadSubscriptionSupport => {
        CoWatchingSubscribeResultSchema.parse(value);
        return "supported";
      }).catch((cause: unknown): ReadSubscriptionSupport => {
        if (cause instanceof JSONRPCErrorException && cause.code === JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND) return "unsupported";
        if (subscriptions.get(characterId) === attempt) subscriptions.delete(characterId);
        throw cause;
      });
      subscriptions.set(characterId, attempt);
      return attempt;
    },
  };
}
export type CoWatchingMethods = ReturnType<typeof coWatchingMethods>;
