import { describe, expect, it, vi } from "vitest";
import type { ModelMessage, ToolModelMessage } from "ai";
import { createNativeToolProjection } from "./native-tool-projection.ts";
import { nativeImageSource } from "./native-image-projection.ts";
import { withNativeToolImages } from "./native-tool-images.ts";
import { createToolMaterialSink } from "../harness/subagent-tool-materials.ts";

function capture(bytes: string) {
  const release = vi.fn();
  const raw = withNativeToolImages({ ok: true }, { images: [{ mediaType: "image/png", dataBase64: bytes }],
    refs: [], context: "captured screen", release });
  const output = { type: "json" as const, value: { ok: true } };
  const message: ToolModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "reused-id", toolName: "capture", output }] };
  return { raw, message, release };
}

function files(messages: ModelMessage[]) {
  return messages.flatMap((message) => message.role === "user" && Array.isArray(message.content)
    ? message.content.flatMap((part) => part.type === "file" ? [part.data] : []) : []);
}

describe("exact native completed-result association", () => {
  it("keeps distinct captures distinct when provider tool ids are reused, including material rendering and repeated projection", () => {
    const first = capture("first-image"); const second = capture("second-image"); const native = createNativeToolProjection();
    native.capture({ results: [{ toolCallId: "reused-id", toolName: "capture", output: first.raw }], messages: [first.message],
      originModelEffectId: "model-effect-1", stepNumber: 0 });
    native.capture({ results: [{ toolCallId: "reused-id", toolName: "capture", output: second.raw }], messages: [second.message],
      originModelEffectId: "model-effect-2", stepNumber: 1 });
    const materials = createToolMaterialSink();
    materials.register({ attemptId: "attempt", toolCallId: "reused-id", toolName: "capture" }, [{ key: "frame", source: undefined }]);
    const projected = native.render(materials.render("attempt", [first.message, second.message]));
    expect(files(projected)).toEqual(["first-image", "second-image"]);
    expect(projected.flatMap((message) => nativeImageSource(message) ? [nativeImageSource(message)] : [])).toEqual([
      expect.objectContaining({ kind: "tool", originModelEffectId: "model-effect-1", stepNumber: 0 }),
      expect.objectContaining({ kind: "tool", originModelEffectId: "model-effect-2", stepNumber: 1 }),
    ]);
    expect(files(native.render(projected))).toEqual(["first-image", "second-image"]);
    native.release();
    expect(first.release).toHaveBeenCalledTimes(1); expect(second.release).toHaveBeenCalledTimes(1);
  });
});
