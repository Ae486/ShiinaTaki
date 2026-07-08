import { describe, expect, it } from "vitest";
import { pong } from "./hello.js";

describe("pong", () => {
  it("echoes the nonce from a ping", () => {
    expect(pong({ kind: "ping", nonce: "xyz" })).toEqual({ kind: "pong", nonce: "xyz" });
  });
});
