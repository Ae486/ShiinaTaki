import { describe, expect, it } from "vitest";
import type { UtilityConfig } from "../config/utility-config.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { createUtilitySlot } from "./utility-slot.ts";

const UTILITY: UtilityConfig = {
  baseUrl: "https://utility.example.com",
  apiKey: "sk-utility",
  model: "cheap-fast-1",
};

function slot(config?: UtilityConfig | null) {
  const mainModel = generatingModel("main");
  const { logger, records } = createCaptureLogger();
  return { mainModel, records, slot: createUtilitySlot({ mainModel, config, logger }) };
}

describe("utility slot model resolution (T5-R11)", () => {
  it("falls back to the MAIN model when no utility slot is configured", () => {
    const h = slot();
    expect(h.slot.model).toBe(h.mainModel);
  });

  it("uses the configured utility provider's model when the slot is set", () => {
    const h = slot(UTILITY);
    expect(h.slot.model).not.toBe(h.mainModel);
    expect(h.slot.model).toMatchObject({ modelId: "cheap-fast-1" });
  });
});

describe("utility slot serialization (R11: background tasks run serially)", () => {
  it("runs two concurrently-queued tasks one after the other", async () => {
    const h = slot();
    const order: string[] = [];
    const first = h.slot.run("a", async () => {
      order.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("a:end");
    });
    const second = h.slot.run("b", async () => {
      order.push("b:start");
      order.push("b:end");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("a failing task resolves undefined, warns, and leaves the chain usable", async () => {
    const h = slot();
    const failed = await h.slot.run("boom", async () => {
      throw new Error("provider down");
    });
    expect(failed).toBeUndefined();
    expect(h.records.some((r) => r.level === "warn" && r.msg === "utility task failed")).toBe(true);

    // The next task must still run: a wedged chain would silently stop every later background pass.
    expect(await h.slot.run("after", async () => "ok")).toBe("ok");
  });
});

describe("utility slot usage accounting", () => {
  it("starts at zero and counts every task it ran", async () => {
    const h = slot();
    expect(h.slot.usage()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 });

    await h.slot.run("a", async () => ({ usage: { inputTokens: 10, outputTokens: 4 } }));
    await h.slot.run("b", async () => ({ usage: { inputTokens: 7, outputTokens: 1 } }));

    expect(h.slot.usage()).toEqual({ calls: 2, inputTokens: 17, outputTokens: 5, usageUnknown: 0 });
  });

  it("tolerates undefined usage fields (v7 types both totals as number | undefined) and tallies them", async () => {
    const h = slot();
    await h.slot.run("partial", async () => ({ usage: { inputTokens: 9, outputTokens: undefined } }));
    await h.slot.run("none", async () => "no usage at all");

    expect(h.slot.usage()).toEqual({ calls: 2, inputTokens: 9, outputTokens: 0, usageUnknown: 2 });
  });

  it("counts a failed task as an unaccounted call", async () => {
    const h = slot();
    await h.slot.run("boom", async () => {
      throw new Error("provider down");
    });
    expect(h.slot.usage()).toMatchObject({ calls: 1, usageUnknown: 1, inputTokens: 0 });
  });

  it("returns a snapshot, not the live totals object", async () => {
    const h = slot();
    const before = h.slot.usage();
    await h.slot.run("a", async () => ({ usage: { inputTokens: 3, outputTokens: 2 } }));
    expect(before.calls).toBe(0);
  });
});
