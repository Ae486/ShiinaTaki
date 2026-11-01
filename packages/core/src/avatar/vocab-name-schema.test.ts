import { describe, expect, it } from "vitest";
import { z } from "zod";
import { vocabNameSchema } from "./vocab-name-schema.ts";

describe("vocabNameSchema", () => {
  it("accepts an in-vocabulary name and rejects one outside it (stale names are structurally invalid — 1e)", () => {
    const schema = vocabNameSchema(["smile01", "angry01"]);
    expect(schema.parse("smile01")).toBe("smile01");
    expect(() => schema.parse("ghost")).toThrow();
  });

  it("serializes to a JSON-Schema enum — what the AI SDK sends the provider to constrain the tool call", () => {
    // The AI SDK builds the tool's JSON Schema via zod's toJSONSchema (provider-utils zod4Schema); the enum is the
    // structural constraint the model sees, so a stale costume name can't be emitted in the first place.
    expect(z.toJSONSchema(vocabNameSchema(["a", "b"]))).toMatchObject({ enum: ["a", "b"] });
  });

  it("falls back to any non-empty string for an empty/unknown vocabulary (z.enum([]) is invalid)", () => {
    const schema = vocabNameSchema([]);
    expect(schema.parse("anything")).toBe("anything");
    expect(() => schema.parse("")).toThrow();
  });

  it("uses the current costume in correction examples while keeping structured allowed values", () => {
    const result = z.object({ name: vocabNameSchema(["new_smile", "new_wave"]) }).safeParse({});
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0];
    expect(issue).toMatchObject({ code: "invalid_value", values: ["new_smile", "new_wave"], path: ["name"] });
    expect(issue?.message).toContain('{"name":"new_smile"}');
    expect(issue?.message).not.toContain("new_wave");
    expect(issue?.message).not.toContain("default");
  });
});
