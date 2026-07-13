/**
 * INPUT:  avatar transitions (nextAvatarState) + the render-activity mapping under test.
 * OUTPUT: assertions covering the transition table, no-op edges, and activity tiers.
 * POS:    unit test for the framework-free FSM (highest-value renderer seam). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { nextAvatarState, renderActivityFor } from "./state-machine.ts";

describe("nextAvatarState", () => {
  it("moves idle into the active states and to sleep", () => {
    expect(nextAvatarState("idle", "think")).toBe("thinking");
    expect(nextAvatarState("idle", "work")).toBe("working");
    expect(nextAvatarState("idle", "sleep")).toBe("sleeping");
  });

  it("switches directly between thinking and working", () => {
    expect(nextAvatarState("thinking", "work")).toBe("working");
    expect(nextAvatarState("working", "think")).toBe("thinking");
  });

  it("rests active states back to idle", () => {
    expect(nextAvatarState("thinking", "rest")).toBe("idle");
    expect(nextAvatarState("working", "rest")).toBe("idle");
  });

  it("only wakes out of sleeping — other events are no-ops while asleep", () => {
    expect(nextAvatarState("sleeping", "wake")).toBe("idle");
    expect(nextAvatarState("sleeping", "think")).toBe("sleeping");
    expect(nextAvatarState("sleeping", "work")).toBe("sleeping");
  });

  it("treats undefined edges as no-ops (idempotent)", () => {
    expect(nextAvatarState("idle", "rest")).toBe("idle");
    expect(nextAvatarState("idle", "wake")).toBe("idle");
    expect(nextAvatarState("thinking", "think")).toBe("thinking");
  });
});

describe("renderActivityFor", () => {
  it("maps each state to its render tier", () => {
    expect(renderActivityFor("idle")).toBe("idle");
    expect(renderActivityFor("thinking")).toBe("active");
    expect(renderActivityFor("working")).toBe("active");
    expect(renderActivityFor("sleeping")).toBe("asleep");
  });
});
