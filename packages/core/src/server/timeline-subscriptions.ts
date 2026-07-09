/**
 * INPUT:  subscribe/unsubscribe(characterId, connection, sink) + publish(entry) from the store's onAppend
 * OUTPUT: createTimelineSubscriptions() -> { subscribe, unsubscribe, publish, count }; characterId→connection→sink
 * POS:    core/server — the timeline.appended fan-out registry (invariant 7); disconnect cleanup driven by ctx.onClose
 */
import type { TimelineEntry } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";

export type TimelineSink = (entry: TimelineEntry) => void;

export interface TimelineSubscriptions {
  subscribe(characterId: string, connection: Connection, sink: TimelineSink): void;
  unsubscribe(characterId: string, connection: Connection): void;
  /** Fans an appended entry out to every connection subscribed to its character. */
  publish(entry: TimelineEntry): void;
  count(characterId: string): number;
}

export function createTimelineSubscriptions(): TimelineSubscriptions {
  // Connection identity keys the inner map, so disconnect cleanup is an O(1) delete.
  const byCharacter = new Map<string, Map<Connection, TimelineSink>>();

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
    publish(entry) {
      const sinks = byCharacter.get(entry.characterId);
      if (!sinks) return;
      for (const sink of sinks.values()) sink(entry);
    },
    count(characterId) {
      return byCharacter.get(characterId)?.size ?? 0;
    },
  };
}
