import { describe, expect, it } from "vitest";
import { createConfigSource } from "./config-source.ts";
import { readViewingInvitationPolicy, VIEWING_INVITATION_KNOBS } from "./viewing-invitation-config.ts";

describe("viewing invitation live settings", () => {
  it("uses the agreed defaults and reads operator changes without rebuilding the source", () => {
    const stored = new Map<string, number>();
    const source = createConfigSource({ env: {}, repo: {
      get: (key) => stored.get(key) ?? null,
      upsert: (key, value) => { if (typeof value === "number") stored.set(key, value); },
      delete: (key) => { stored.delete(key); },
      all: () => stored,
    } });
    expect(readViewingInvitationPolicy(source)).toEqual({ effectivePlaybackMs: 60_000, minimumRemainingSeconds: 120, invitationTtlMs: 120_000 });
    stored.set("TAKI_INITIATIVE_VIEWING_REMAINING_SECONDS", 45);
    expect(readViewingInvitationPolicy(source).minimumRemainingSeconds).toBe(45);
  });
  it("rejects zero, fractional, invalid and overflowing settings at the registry boundary", () => {
    for (const knob of VIEWING_INVITATION_KNOBS) {
      for (const value of [0, -1, 0.5, Number.POSITIVE_INFINITY, "invalid", 1e12]) {
        expect(knob.schema.safeParse(value).success).toBe(false);
      }
    }
  });
});
