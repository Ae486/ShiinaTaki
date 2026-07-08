import { describe, expect, it } from "vitest";
import { PingSchema, PongSchema } from "./ping-schema.js";

describe("ping/pong schemas", () => {
  it("round-trips a valid ping", () => {
    const parsed = PingSchema.parse({ kind: "ping", nonce: "abc" });
    expect(parsed.nonce).toBe("abc");
  });

  it("rejects a wrong kind", () => {
    expect(() => PongSchema.parse({ kind: "ping", nonce: "abc" })).toThrow();
  });
});
