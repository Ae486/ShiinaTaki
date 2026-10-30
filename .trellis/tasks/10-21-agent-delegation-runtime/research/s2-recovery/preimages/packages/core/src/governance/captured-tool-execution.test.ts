import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { bindCapturedToolExecution, governedExecutionContext } from "./captured-tool-execution.ts";

describe("captured tool execution binding", () => {
  it("keeps immutable sidecars and original closures while isolating each execution identity", async () => {
    const observed: unknown[] = [];
    const execute = vi.fn(async (_input, options) => { observed.push(governedExecutionContext(options)); return "original"; });
    const original = tool({ inputSchema: z.object({}), execute });
    const sidecar = Symbol("captured-authority");
    Object.defineProperty(original, sidecar, { value: "exact-generation", enumerable: false });
    Object.freeze(original);
    const tools = Object.freeze({ original });
    const effects = {} as EffectLifecycleService;
    const mutable = { runId: "run-a", attemptId: "attempt-a", effects };
    const first = bindCapturedToolExecution(tools, mutable);
    mutable.runId = "run-b"; mutable.attemptId = "attempt-b";
    const second = bindCapturedToolExecution(tools, mutable);
    await first.original!.execute!({}, { toolCallId: "first", messages: [] } as never);
    await second.original!.execute!({}, { toolCallId: "second", messages: [] } as never);
    expect(observed).toEqual([{ runId: "run-a", attemptId: "attempt-a", effects }, { runId: "run-b", attemptId: "attempt-b", effects }]);
    expect(Object.getOwnPropertyDescriptor(first.original, sidecar)?.value).toBe("exact-generation");
    expect(Object.isFrozen(first.original)).toBe(true);
    expect(original.execute).toBe(execute);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(governedExecutionContext({ execution: mutable, runId: "spoofed" })).toBeUndefined();
  });

  it.each(["run", "caller"] as const)("retains both cancellation sources and refuses a cancelled %s execution", async (source) => {
    const run = new AbortController(); const caller = new AbortController();
    const execute = vi.fn(async (_input, options) => options.abortSignal);
    const original = tool({ inputSchema: z.object({}), execute });
    const bound = bindCapturedToolExecution({ original }, { runId: "run", attemptId: "attempt", effects: {} as EffectLifecycleService, signal: run.signal });
    const options = { toolCallId: "call", messages: [], abortSignal: caller.signal } as never;
    const signal = await bound.original!.execute!({}, options) as AbortSignal;
    expect(signal.aborted).toBe(false);
    (source === "run" ? run : caller).abort();
    expect(signal.aborted).toBe(true);
    expect(await bound.original!.execute!({}, options)).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(execute).toHaveBeenCalledOnce();
  });
});
