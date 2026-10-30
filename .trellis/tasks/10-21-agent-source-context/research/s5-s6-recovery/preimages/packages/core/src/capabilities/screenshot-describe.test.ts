import { describe, expect, it, vi } from "vitest";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import { createScreenshotDescriber } from "./screenshot-describe.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";

const INPUT = { dataBase64: "AAAA", mediaType: "image/png" };

function captureWarn() {
  return { warn: vi.fn() };
}

function systemInstructions(model: ReturnType<typeof generatingModel>): string {
  const message = model.doGenerateCalls[0]?.prompt.find((part) => part.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

describe("createScreenshotDescriber", () => {
  it("records an invitation vision call in the original Run and charges through its existing callback", async () => {
    const fixture = initiativeFixture();
    try {
      const admitted = await fixture.admit(); const charge = vi.fn();
      const describer = createScreenshotDescriber({ model: generatingModel("A video is playing."), logger: captureWarn() });
      expect(await describer.describe(INPUT, { ...admitted, effects: fixture.effects, onCommitModelIntent: charge }))
        .toBe("A video is playing.");
      expect(charge).toHaveBeenCalledOnce();
      expect(fixture.db.prepare("SELECT run_id,kind,state,outcome FROM run_effects WHERE run_id=:runId").all({ runId: admitted.runId }))
        .toEqual([expect.objectContaining({ run_id: admitted.runId, kind: "model", state: "terminal", outcome: "completed" })]);
    } finally { fixture.db.close(); }
  });

  it("does not invoke vision after cancellation", async () => {
    const fixture = initiativeFixture();
    try {
      const admitted = await fixture.admit(); const model = generatingModel("Unused");
      const describer = createScreenshotDescriber({ model, logger: captureWarn() });
      expect(await describer.describe(INPUT, { ...admitted, effects: fixture.effects, signal: AbortSignal.abort() })).toBeNull();
      expect(model.doGenerateCalls).toHaveLength(0);
    } finally { fixture.db.close(); }
  });
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
