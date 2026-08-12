import { describe, expect, it, vi } from "vitest";
import type { PerceptionPauseState } from "@taki/shared";
import { readPauseReplacement } from "./use-perception.ts";

const PAUSED: PerceptionPauseState = { paused: true, until: null };

describe("perception pause replacement read", () => {
  it("clears a stale read error only after the replacement state succeeds", async () => {
    const order: string[] = [];
    const client = {
      perceptionPauseGet: vi.fn(async () => {
        order.push("read");
        return PAUSED;
      }),
    };

    await readPauseReplacement(
      client,
      () => order.push("apply"),
      () => order.push("clear-error"),
    );

    expect(order).toEqual(["read", "apply", "clear-error"]);
  });

  it("does not clear the existing error when the replacement read fails", async () => {
    const clearError = vi.fn();
    const client = { perceptionPauseGet: vi.fn(async () => Promise.reject(new Error("offline"))) };

    await expect(readPauseReplacement(client, vi.fn(), clearError)).rejects.toThrow("offline");
    expect(clearError).not.toHaveBeenCalled();
  });
});
