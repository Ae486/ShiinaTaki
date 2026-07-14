/**
 * INPUT:  subscribe/unsubscribe(characterId, connection, sink) + publish(command) from the avatar tools' execute
 * OUTPUT: createAvatarSubscriptions() -> { subscribe, unsubscribe, publish, count }; characterId→connection→sink
 * POS:    core/avatar — the avatar.command fan-out registry (invariant 7); disconnect cleanup driven by ctx.onClose
 */
import type { AvatarCommand } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";

export type AvatarSink = (command: AvatarCommand) => void;

export interface AvatarSubscriptions {
  subscribe(characterId: string, connection: Connection, sink: AvatarSink): void;
  unsubscribe(characterId: string, connection: Connection): void;
  /** Fans a command out to every connection subscribed to its character (fire-and-forget). */
  publish(command: AvatarCommand): void;
  count(characterId: string): number;
}

export function createAvatarSubscriptions(): AvatarSubscriptions {
  // Connection identity keys the inner map, so disconnect cleanup is an O(1) delete.
  const byCharacter = new Map<string, Map<Connection, AvatarSink>>();

  return {
    subscribe(characterId, connection, sink) {
      let sinks = byCharacter.get(characterId);
      if (!sinks) {
        sinks = new Map();
        byCharacter.set(characterId, sinks);
      }
      sinks.set(connection, sink); // idempotent: re-subscribing the same connection replaces its sink
    },
    unsubscribe(characterId, connection) {
      const sinks = byCharacter.get(characterId);
      if (!sinks) return;
      sinks.delete(connection);
      if (sinks.size === 0) byCharacter.delete(characterId);
    },
    publish(command) {
      // No Pet UI subscribed (invariant 4: a disposable client) → the emotion simply isn't rendered; never an error.
      const sinks = byCharacter.get(command.characterId);
      if (!sinks) return;
      for (const sink of sinks.values()) sink(command);
    },
    count(characterId) {
      return byCharacter.get(characterId)?.size ?? 0;
    },
  };
}
