/**
 * INPUT:  authenticated Character subscriptions and committed Timeline / disposable activity facts
 * OUTPUT: isolated fan-out with one initiator delivery and connection-scoped cleanup
 * POS:    core/server — the existing Character subscription registry; no new socket or execution authority
 */
import type { ChatActivity, TimelineCommitted, TimelineEntry, TimelineRemoved } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";

/** One subscriber's two push handlers: an appended entry and a retract (removed) ref — the sibling of onAppend/onRemove. */
export interface TimelineSink {
  appended(entry: TimelineEntry): void;
  removed(ref: TimelineRemoved): void;
  committed?(batch: TimelineCommitted): void;
  activity?(event: ChatActivity): void;
}

export interface TimelineSubscriptions {
  subscribe(characterId: string, connection: Connection, sink: TimelineSink): void;
  unsubscribe(characterId: string, connection: Connection): void;
  /** Fans an appended entry out to every connection subscribed to its character. */
  publish(entry: TimelineEntry): void;
  /** Fans a retract (removed) ref out to every connection subscribed to its character. */
  publishRemoved(ref: TimelineRemoved): void;
  publishCommitted(batch: TimelineCommitted): void;
  publishActivity(event: ChatActivity, initiator?: { connection: Connection; notify(event: ChatActivity): void }): void;
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
      for (const sink of sinks.values()) publish(() => sink.appended(entry));
    },
    publishRemoved(ref) {
      const sinks = byCharacter.get(ref.characterId);
      if (!sinks) return;
      for (const sink of sinks.values()) publish(() => sink.removed(ref));
    },
    publishCommitted(batch) {
      for (const sink of byCharacter.get(batch.characterId)?.values() ?? []) publish(() => sink.committed?.(batch));
    },
    publishActivity(event, initiator) {
      for (const [connection, sink] of byCharacter.get(event.characterId) ?? []) {
        if (connection !== initiator?.connection) publish(() => sink.activity?.(event));
      }
      if (initiator) publish(() => initiator.notify(event));
    },
    count(characterId) {
      return byCharacter.get(characterId)?.size ?? 0;
    },
  };
}

function publish(notify: () => void): void {
  try { notify(); } catch { /* A disconnected observer cannot suppress another authorized subscriber. */ }
}
