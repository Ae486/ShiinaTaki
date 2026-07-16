import { describe, expect, it, vi } from "vitest";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import { createScreenshotDescriber } from "./screenshot-describe.ts";

const INPUT = { dataBase64: "AAAA", mediaType: "image/png" };

function captureWarn() {
  return { warn: vi.fn() };
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
});
