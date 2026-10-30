import { describe, expect, it } from "vitest";
import type { ConfigSource } from "./config-source.ts";
import { avatarOutcomeDeadlineMs, DEFAULT_AVATAR_OUTCOME_DEADLINE_MS } from "./avatar-config.ts";

function sourceOf(values: Array<unknown>): ConfigSource {
  return {
    resolve: () => ({ value: values.shift() as never, origin: "stored" }),
    env: () => ({}),
    effectiveAll: () => [],
  };
}

describe("avatarOutcomeDeadlineMs", () => {
  it("re-reads the effective value on every call and coerces env text", () => {
    const read = avatarOutcomeDeadlineMs(sourceOf([250, "900", 3000]));
    expect([read(), read(), read()]).toEqual([250, 900, 3000]);
  });

  it("falls back to the default for an absent or out-of-range value", () => {
    const read = avatarOutcomeDeadlineMs(sourceOf([null, 5, "abc"]));
    expect([read(), read(), read()]).toEqual(Array(3).fill(DEFAULT_AVATAR_OUTCOME_DEADLINE_MS));
  });
});
