import { describe, expect, it, vi } from "vitest";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import { createScreenshotDescriber } from "./screenshot-describe.ts";

const INPUT = { dataBase64: "AAAA", mediaType: "image/png" };

function captureWarn() {
  return { warn: vi.fn() };
}

function systemInstructions(model: ReturnType<typeof generatingModel>): string {
  const message = model.doGenerateCalls[0]?.prompt.find((part) => part.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

describe("createScreenshotDescriber", () => {
  it("returns the VLM's trimmed description", async () => {
    const describer = createScreenshotDescriber({
      model: generatingModel("  A code editor with all tests passing.  "),
      logger: captureWarn(),
    });
    await expect(describer.describe(INPUT)).resolves.toBe("A code editor with all tests passing.");
  });

  it("returns null on an empty VLM reply", async () => {
    const describer = createScreenshotDescriber({ model: generatingModel("   "), logger: captureWarn() });
    await expect(describer.describe(INPUT)).resolves.toBeNull();
  });

  it("degrades to null (warn, never throws) when the VLM call fails", async () => {
    const logger = captureWarn();
    const describer = createScreenshotDescriber({ model: failingGenerateModel(new Error("boom")), logger });
    await expect(describer.describe(INPUT)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("appends the caller focus to the base framing — the guardrails survive, never replaced", async () => {
    const model = generatingModel("A dialog.");
    const describer = createScreenshotDescriber({ model, logger: captureWarn() });
    await describer.describe({ ...INPUT, prompt: "  the error dialog text  " });
    const instructions = systemInstructions(model);
    expect(instructions).toContain("at most 200 words");
    expect(instructions).toContain("Focus especially on: the error dialog text");
  });

  it("treats a blank/whitespace prompt as absent (base framing only)", async () => {
    const model = generatingModel("A screen.");
    const describer = createScreenshotDescriber({ model, logger: captureWarn() });
    await describer.describe({ ...INPUT, prompt: "   " });
    const instructions = systemInstructions(model);
    expect(instructions).toContain("at most 200 words");
    expect(instructions).not.toContain("Focus especially on");
  });
});
