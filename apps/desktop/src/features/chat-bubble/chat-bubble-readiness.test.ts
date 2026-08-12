import { describe, expect, it } from "vitest";
import { bubbleSubmission } from "./chat-bubble.tsx";

describe("pet bubble submission readiness", () => {
  it("keeps a reconnect-time draft local by refusing to produce a submitted message", () => {
    expect(bubbleSubmission("  keep this draft  ", false, false)).toBeNull();
  });

  it("returns the trimmed draft only when connected and idle", () => {
    expect(bubbleSubmission("  hello  ", false, true)).toBe("hello");
    expect(bubbleSubmission("hello", true, true)).toBeNull();
  });
});
