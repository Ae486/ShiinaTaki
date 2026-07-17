/**
 * INPUT:  subscribe/unsubscribe(characterId, connection, sink) + publish(entry)/publishRemoved(ref) from the store's onAppend/onRemove
 * OUTPUT: createTimelineSubscriptions() -> { subscribe, unsubscribe, publish, publishRemoved, count }; characterId→connection→sink
 * POS:    core/server — the timeline.appended/removed fan-out registry (invariant 7); disconnect cleanup driven by ctx.onClose
 */
import type { TimelineEntry, TimelineRemoved } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";

/** One subscriber's two push handlers: an appended entry and a retract (removed) ref — the sibling of onAppend/onRemove. */
export interface TimelineSink {
  appended(entry: TimelineEntry): void;
  removed(ref: TimelineRemoved): void;
}

export interface TimelineSubscriptions {
  subscribe(characterId: string, connection: Connection, sink: TimelineSink): void;
  unsubscribe(characterId: string, connection: Connection): void;
  /** Fans an appended entry out to every connection subscribed to its character. */
  publish(entry: TimelineEntry): void;
  /** Fans a retract (removed) ref out to every connection subscribed to its character. */
  publishRemoved(ref: TimelineRemoved): void;
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
      for (const sink of sinks.values()) sink.appended(entry);
    },
    publishRemoved(ref) {
      const sinks = byCharacter.get(ref.characterId);
      if (!sinks) return;
      for (const sink of sinks.values()) sink.removed(ref);
    },
    count(characterId) {
      return byCharacter.get(characterId)?.size ?? 0;
    },
  };
}
