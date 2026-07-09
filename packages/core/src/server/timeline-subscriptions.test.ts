import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";
import { createTimelineSubscriptions } from "./timeline-subscriptions.ts";

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

describe("createTimelineSubscriptions", () => {
  it("delivers a published entry to a subscriber of that character", () => {
    const subs = createTimelineSubscriptions();
    const received: TimelineEntry[] = [];
    subs.subscribe("taki", conn(), (e) => received.push(e));

    subs.publish(entry("taki"));

    expect(received).toEqual([entry("taki")]);
  });

  it("does not deliver to subscribers of a different character", () => {
    const subs = createTimelineSubscriptions();
    const received: TimelineEntry[] = [];
    subs.subscribe("yui", conn(), (e) => received.push(e));

    subs.publish(entry("taki"));

    expect(received).toEqual([]);
  });

  it("fans one entry out to every subscriber of the same character", () => {
    const subs = createTimelineSubscriptions();
    const a: TimelineEntry[] = [];
    const b: TimelineEntry[] = [];
    subs.subscribe("taki", conn(), (e) => a.push(e));
    subs.subscribe("taki", conn(), (e) => b.push(e));

    subs.publish(entry("taki"));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(subs.count("taki")).toBe(2);
  });

  it("stops delivering after unsubscribe and drops the count", () => {
    const subs = createTimelineSubscriptions();
    const c = conn();
    const received: TimelineEntry[] = [];
    subs.subscribe("taki", c, (e) => received.push(e));
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
