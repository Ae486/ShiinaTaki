import { describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineRemoved } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";
import { createTimelineSubscriptions, type TimelineSink } from "./timeline-subscriptions.ts";

function conn(): Connection {
  return { state: { status: "awaiting" } };
}

function entry(characterId: string, seq = 1): TimelineEntry {
  return {
    seq,
    id: "550e8400-e29b-41d4-a716-446655440000",
    characterId,
    role: "user",
    content: "hi",
    createdAt: "2026-07-10T00:00:00.000Z",
  };
}

// A sink that records only appended entries (the removed handler is a no-op unless a test overrides it).
function appendSink(received: TimelineEntry[]): TimelineSink {
  return { appended: (e) => received.push(e), removed: () => undefined };
}

describe("createTimelineSubscriptions", () => {
  it("delivers a published entry to a subscriber of that character", () => {
    const subs = createTimelineSubscriptions();
    const received: TimelineEntry[] = [];
    subs.subscribe("taki", conn(), appendSink(received));

    subs.publish(entry("taki"));

    expect(received).toEqual([entry("taki")]);
  });

  it("does not deliver to subscribers of a different character", () => {
    const subs = createTimelineSubscriptions();
    const received: TimelineEntry[] = [];
    subs.subscribe("yui", conn(), appendSink(received));

    subs.publish(entry("taki"));

    expect(received).toEqual([]);
  });

  it("fans one entry out to every subscriber of the same character", () => {
    const subs = createTimelineSubscriptions();
    const a: TimelineEntry[] = [];
    const b: TimelineEntry[] = [];
    subs.subscribe("taki", conn(), appendSink(a));
    subs.subscribe("taki", conn(), appendSink(b));

    subs.publish(entry("taki"));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(subs.count("taki")).toBe(2);
  });

  it("fans a removed ref out only to the character's subscribers (mirrors publish)", () => {
    const subs = createTimelineSubscriptions();
    const takiRemoved: TimelineRemoved[] = [];
    const yuiRemoved: TimelineRemoved[] = [];
    subs.subscribe("taki", conn(), { appended: () => undefined, removed: (r) => takiRemoved.push(r) });
    subs.subscribe("yui", conn(), { appended: () => undefined, removed: (r) => yuiRemoved.push(r) });

    subs.publishRemoved({ characterId: "taki", seq: 7 });

    expect(takiRemoved).toEqual([{ characterId: "taki", seq: 7 }]);
    expect(yuiRemoved).toEqual([]);
  });

  it("stops delivering after unsubscribe and drops the count", () => {
    const subs = createTimelineSubscriptions();
    const c = conn();
    const received: TimelineEntry[] = [];
    subs.subscribe("taki", c, appendSink(received));
    expect(subs.count("taki")).toBe(1);

    subs.unsubscribe("taki", c);
    expect(subs.count("taki")).toBe(0);
    subs.publish(entry("taki"));

    expect(received).toEqual([]);
  });

  it("treats unsubscribe of an unknown connection as a no-op", () => {
    const subs = createTimelineSubscriptions();
    expect(() => subs.unsubscribe("taki", conn())).not.toThrow();
    expect(subs.count("taki")).toBe(0);
  });
});
