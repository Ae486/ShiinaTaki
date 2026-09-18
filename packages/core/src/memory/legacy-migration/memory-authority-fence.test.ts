import { describe, expect, it, vi } from "vitest";
import { createMemoryAuthorityFence } from "./memory-authority-fence.ts";

describe("irrevocable memory authority retirement", () => {
  it("keeps admissions retired when a post-commit callback throws", async () => {
    const fence = createMemoryAuthorityFence();
    const failure = new Error("activation observer failed");

    await expect(fence.quiesce({ timeoutMs: 1_000 }, async () => {
      fence.retire();
      throw failure;
    })).rejects.toBe(failure);

    fence.retire();
    const write = vi.fn();
    expect(() => fence.admitSync(write)).toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(fence.admit(write)).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(fence.quiesce({ timeoutMs: 1_000 }, async () => undefined))
      .rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    expect(write).not.toHaveBeenCalled();
  });

  it("reopens after a pre-commit failure without an irrevocable retirement", async () => {
    const fence = createMemoryAuthorityFence();
    await expect(fence.quiesce({ timeoutMs: 1_000, retireOnSuccess: true }, async () => {
      throw new Error("transaction rolled back");
    })).rejects.toThrow("transaction rolled back");

    expect(fence.admitSync(() => "legacy write")).toBe("legacy write");
    await expect(fence.admit(() => "legacy maintenance")).resolves.toBe("legacy maintenance");
  });

  it("does not reopen a retired fence when draining earlier work times out", async () => {
    const fence = createMemoryAuthorityFence();
    let release: () => void = () => undefined;
    const held = fence.admit(() => new Promise<void>((resolve) => { release = resolve; }));
    const transition = fence.quiesce({ timeoutMs: 10 }, async () => undefined);
    fence.retire();

    await expect(transition).rejects.toThrow("MEMORY_QUIESCENCE_TIMEOUT");
    release();
    await held;
    expect(() => fence.admitSync(() => undefined)).toThrow("MEMORY_AUTHORITY_FENCED");
  });
});
