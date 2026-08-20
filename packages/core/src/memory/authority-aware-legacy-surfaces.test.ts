import { describe, expect, it, vi } from "vitest";
import { authorityAwareAutoMemory, authorityAwareTidy, authorityAwareWrite } from "./authority-aware-legacy-surfaces.ts";

describe("authority-aware legacy surfaces", () => {
  it("retires detached auto-memory and direct writes after canonical activation", async () => {
    let canonical = false;
    const autoCall = vi.fn(async () => undefined);
    const writeCall = vi.fn(() => ({ id: "legacy" }));
    const auto = authorityAwareAutoMemory({ onTurnCompleted: autoCall }, () => canonical);
    const write = authorityAwareWrite(writeCall, () => canonical);
    await auto.onTurnCompleted("taki"); expect(write({ characterId: "taki", layer: "profile", content: "x", importance: 1 })).toEqual({ id: "legacy" });
    canonical = true;
    await auto.onTurnCompleted("taki"); expect(() => write({ characterId: "taki", layer: "profile", content: "x", importance: 1 })).toThrow("MEMORY_LEGACY_WRITE_RETIRED");
    expect(autoCall).toHaveBeenCalledOnce(); expect(writeCall).toHaveBeenCalledOnce();
  });

  it("keeps the legacy tidy model and store untouched after activation", async () => {
    let canonical = false;
    const maybeRun = vi.fn(async () => undefined); const runNow = vi.fn(async () => ({ status: "ran" as const, defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 0 }, edits: 1, steps: 1, usage: { calls: 1, inputTokens: 1, outputTokens: 1, usageUnknown: 0 } }));
    const tidy = authorityAwareTidy({ maybeRun, runNow }, () => canonical);
    await tidy.maybeRun("taki"); expect((await tidy.runNow("taki")).status).toBe("ran");
    canonical = true;
    await tidy.maybeRun("taki"); expect(await tidy.runNow("taki")).toMatchObject({ status: "clean", edits: 0, steps: 0 });
    expect(maybeRun).toHaveBeenCalledOnce(); expect(runNow).toHaveBeenCalledOnce();
  });
});
