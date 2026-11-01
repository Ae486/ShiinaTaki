import { describe, expect, it, vi } from "vitest";
import { simulateReadableStream } from "ai";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createModelEffectMiddleware } from "./model-effect-middleware.ts";

function fixture() {
  const lifecycle = {
    prepare: () => ({ effectId: "e", runId: "r", attemptId: "a", version: 0 }),
    settle: vi.fn(() => ({ stale: false, duplicate: false })),
  } as unknown as EffectLifecycleService;
  return { lifecycle, middleware: createModelEffectMiddleware({ lifecycle, runId: "r", attemptId: "a" }) };
}

describe("direct primary cache usage", () => {
  it.each(["generate", "stream"])("distinguishes omitted raw cache and observed zero on %s", async (mode) => {
    for (const explicit of [false, true]) {
      const f = fixture();
      const usage = { inputTokens: { total: 100, cacheRead: 0 }, outputTokens: { total: 10 },
        raw: { prompt_tokens: 100, completion_tokens: 10, ...(explicit ? { prompt_cache_hit_tokens: 0 } : {}) } };
      const args = { params: { prompt: [] }, model: { provider: "custom-alias", modelId: "model" },
        doGenerate: async () => ({ content: [], usage }),
        doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: "finish", usage }] }) }) };
      if (mode === "generate") await f.middleware.wrapGenerate?.(args as never);
      else {
        const result = await f.middleware.wrapStream?.(args as never); const reader = result?.stream.getReader();
        if (!reader) throw new Error("expected stream");
        while (!(await reader.read()).done) { /* consume the unchanged provider stream */ }
      }
      expect(f.lifecycle.settle).toHaveBeenCalledOnce();
      const accepted = vi.mocked(f.lifecycle.settle).mock.calls[0]?.[0].usage;
      expect(accepted?.cacheReadObserved).toBe(explicit);
      expect(accepted?.inputTokenDetails?.cacheReadTokens).toBe(explicit ? 0 : undefined);
      expect(accepted).not.toHaveProperty("raw");
    }
  });
});
