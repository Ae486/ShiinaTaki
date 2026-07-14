import { describe, expect, it } from "vitest";
import type { AvatarCommand } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import { createAvatarSubscriptions } from "./avatar-subscriptions.ts";

function fakeConnection(): Connection {
  return { state: { status: "awaiting" } };
}
const expr = (characterId: string, name: string): AvatarCommand => ({ characterId, kind: "expression", name });

describe("createAvatarSubscriptions", () => {
  it("fans a published command to every sink subscribed to its character", () => {
    const subs = createAvatarSubscriptions();
    const a: AvatarCommand[] = [];
    const b: AvatarCommand[] = [];
    subs.subscribe("taki", fakeConnection(), (c) => a.push(c));
    subs.subscribe("taki", fakeConnection(), (c) => b.push(c));

    subs.publish(expr("taki", "smile01"));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.name).toBe("smile01");
  });

  it("does not deliver to sinks of a different character", () => {
    const subs = createAvatarSubscriptions();
    const other: AvatarCommand[] = [];
    subs.subscribe("other", fakeConnection(), (c) => other.push(c));

    subs.publish(expr("taki", "smile01"));

    expect(other).toHaveLength(0);
  });

  it("is a harmless no-op when nobody is subscribed (a disposable Pet UI, invariant 4)", () => {
    const subs = createAvatarSubscriptions();
    expect(() => subs.publish(expr("taki", "smile01"))).not.toThrow();
    expect(subs.count("taki")).toBe(0);
  });

  it("unsubscribe stops delivery and drops the empty character bucket", () => {
    const subs = createAvatarSubscriptions();
    const conn = fakeConnection();
    const seen: AvatarCommand[] = [];
    subs.subscribe("taki", conn, (c) => seen.push(c));
    expect(subs.count("taki")).toBe(1);

    subs.unsubscribe("taki", conn);
    expect(subs.count("taki")).toBe(0);
    subs.publish(expr("taki", "smile01"));
    expect(seen).toHaveLength(0);
  });

  it("re-subscribing the same connection replaces its sink (idempotent)", () => {
    const subs = createAvatarSubscriptions();
    const conn = fakeConnection();
    const first: AvatarCommand[] = [];
    const second: AvatarCommand[] = [];
    subs.subscribe("taki", conn, (c) => first.push(c));
    subs.subscribe("taki", conn, (c) => second.push(c));

    expect(subs.count("taki")).toBe(1);
    subs.publish(expr("taki", "smile01"));
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });
});
