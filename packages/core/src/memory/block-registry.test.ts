import { describe, expect, it } from "vitest";
import { BlockDefinitionSchema, getBlock, V1_BLOCKS } from "./block-registry.ts";

describe("block registry (declarative rows, validated at load)", () => {
  it("carries the three v1 blocks in their injection order", () => {
    // PRD §3: the user's hard facts, then her own reading of the user, then the index as navigation.
    expect(V1_BLOCKS.map((block) => block.id)).toEqual(["user-card", "user-model", "memory-index"]);
  });

  it("declares the writer + ownership policy each block's store enforcement reads", () => {
    // R7: the identity card is the USER's — no agent-side path may write it. The two maintained blocks are the
    // background pass's (the tidy pass in batch 4), and the per-character index is scoped to one character.
    expect(getBlock("user-card")).toMatchObject({ ownership: "global", writer: "user" });
    expect(getBlock("memory-index")).toMatchObject({ ownership: "per-character", writer: "background" });
    expect(getBlock("user-model")).toMatchObject({ ownership: "global", writer: "background" });
  });

  it("gives every block a prompt header and a positive token budget", () => {
    for (const block of V1_BLOCKS) {
      expect(block.header.length).toBeGreaterThan(0);
      expect(block.budgetTokens).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an id that is not a block", () => {
    expect(getBlock("episodes")).toBeUndefined();
  });

  it("rejects a malformed row at parse time (the registry can never load half-valid)", () => {
    const valid = { id: "a-block", ownership: "global", writer: "user", header: "h", budgetTokens: 10 };
    expect(() => BlockDefinitionSchema.parse(valid)).not.toThrow();
    expect(() => BlockDefinitionSchema.parse({ ...valid, id: "Not Kebab" })).toThrow();
    expect(() => BlockDefinitionSchema.parse({ ...valid, writer: "agent" })).toThrow();
    expect(() => BlockDefinitionSchema.parse({ ...valid, budgetTokens: 0 })).toThrow();
    expect(() => BlockDefinitionSchema.parse({ ...valid, extra: true })).toThrow();
  });
});
