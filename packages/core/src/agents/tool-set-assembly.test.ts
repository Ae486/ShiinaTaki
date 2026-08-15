import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { mergeToolSets } from "./tool-set-assembly.ts";

function namedTool(name: string) {
  return tool({ description: name, inputSchema: z.object({}), execute: () => name });
}

describe("mergeToolSets", () => {
  it("preserves disjoint tools", () => {
    expect(Object.keys(mergeToolSets({ alpha: namedTool("alpha") }, { beta: namedTool("beta") })))
      .toEqual(["alpha", "beta"]);
  });

  it("rejects a model-facing key collision instead of selecting an authority by spread order", () => {
    expect(() => mergeToolSets({ shared: namedTool("core") }, { shared: namedTool("external") }))
      .toThrow("duplicate model-facing tool key 'shared'");
  });
});
