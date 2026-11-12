/**
 * INPUT:  admission-captured Tool closures and trusted per-execution Run/Attempt/Effect/abort authority
 * OUTPUT: detached tools forwarding exact closures with process-local execution context in SDK options
 * POS:    core/governance — execution binding only; no discovery, permission grant, or second Effect bracket
 */
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";
import type { GovernedEffectContext } from "./governed-tool.ts";

const EXECUTION_CONTEXT = Symbol("taki.governed-execution-context");

export function governedExecutionContext(options: unknown): GovernedEffectContext | undefined {
  return typeof options === "object" && options !== null
    ? (options as Record<PropertyKey, unknown>)[EXECUTION_CONTEXT] as GovernedEffectContext | undefined : undefined;
}

export function bindCapturedToolExecution(tools: ToolSet, execution: GovernedEffectContext): ToolSet {
  // Capture the supplied identity by value: a reused mutable Turn bag must not retarget an in-flight invocation.
  const captured = Object.freeze({ ...execution });
  return Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, value]) => {
    const execute = value.execute;
    if (!execute) return [name, value];
    const descriptors = Object.getOwnPropertyDescriptors(value);
    descriptors.execute = { ...descriptors.execute,
      value: (input: unknown, options: ToolExecutionOptions<unknown>) => {
        const abortSignal = executionSignal(captured.signal, options.abortSignal);
        if (abortSignal?.aborted) return { ok: false, code: "CANCELLED", message: "Run execution was cancelled" };
        return execute(input, { ...options, abortSignal, [EXECUTION_CONTEXT]: captured } as ToolExecutionOptions<unknown>);
      } };
    return [name, Object.freeze(Object.create(Object.getPrototypeOf(value), descriptors)) as Tool];
  })));
}

function executionSignal(run?: AbortSignal, caller?: AbortSignal): AbortSignal | undefined {
  return run && caller && run !== caller ? AbortSignal.any([run, caller]) : run ?? caller;
}
