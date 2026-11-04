import { describe, expect, it } from "vitest";
import type { ToolResultPart } from "ai";
import { projectNativeToolImageOutput } from "./native-tool-image-output.ts";

describe("declared SDK tool image projection", () => {
  it("normalizes stored native URL data and explicit image references while keeping other union members", () => {
    const parts = [
      { type: "file", mediaType: "image/png", data: { type: "url", url: "https://example.invalid/original.png" } },
      { type: "image-file-reference", providerReference: { "native-wire": "file-original" } },
      { type: "image-file-id", fileId: "unbound-file-id" },
      { type: "file", mediaType: "audio/wav", data: { type: "data", data: "original-audio" } },
      { type: "custom", providerOptions: { fixture: { original: true } } },
    ];
    const result = projectNativeToolImageOutput({ type: "content", value: parts } as ToolResultPart["output"]);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.data).toMatchObject({ type: "url", url: new URL("https://example.invalid/original.png") });
    expect(result.files[1]?.data).toMatchObject({ type: "reference", reference: { "native-wire": "file-original" } });
    expect(result.output).toMatchObject({ type: "content", value: [expect.anything(), expect.anything(),
      { type: "text", text: expect.stringContaining("UNBOUND_PROVIDER_REFERENCE") }, parts[3], parts[4]] });
    expect(parts[0]?.data).toEqual({ type: "url", url: "https://example.invalid/original.png" });
  });

  it("does not infer images from JSON payloads or unknown custom content", () => {
    const json: ToolResultPart["output"] = { type: "json", value: { content: [{ type: "image-data", data: "base64", mediaType: "image/png" }] } };
    expect(projectNativeToolImageOutput(json)).toEqual({ output: json, files: [] });
    const custom: ToolResultPart["output"] = { type: "content", value: [{ type: "custom", providerOptions: { fixture: { kind: "image-data", data: "base64" } } }] };
    expect(projectNativeToolImageOutput(custom)).toEqual({ output: custom, files: [] });
  });
});
