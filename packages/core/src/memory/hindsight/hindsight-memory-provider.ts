/**
 * INPUT:  admitted Hindsight connection, exact application replica and durable foreground write ports
 * OUTPUT: a real MemoryProvider with native reads/reflection, truthful Pending outcomes and stable authority
 * POS:    core/memory/hindsight — provider composition; Core alone owns policy, Run capture and Compaction
 */
import { z } from "zod";
import {
  RetainRequestSchema, RecallRequestSchema, ReflectRequestSchema, MutationRequestSchema,
  type MemoryProviderCapabilities, type MemoryResult,
} from "@taki/shared";
import type { MemoryProvider, MemoryProviderCallContext } from "../memory-provider.ts";
import { createHindsightMemoryProviderState, hindsightProviderCall, hindsightProviderError,
  type HindsightMemoryProviderDeps, type HindsightMemoryProviderState } from "./hindsight-memory-provider-context.ts";
import { recallHindsightMemory } from "./hindsight-memory-recall.ts";
import { reflectHindsightMemory } from "./hindsight-memory-reflect.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";

export function createHindsightMemoryProvider(deps: HindsightMemoryProviderDeps): MemoryProvider & {
  capabilitiesSnapshot(): MemoryProviderCapabilities | undefined;
  stop(): Promise<void>; settle(): Promise<void>;
} {
  const controller = new AbortController(); const active = new Set<Promise<unknown>>();
  const signal = deps.signal ? AbortSignal.any([deps.signal, controller.signal]) : controller.signal;
  const state = createHindsightMemoryProviderState({ ...deps, signal });
  const track = <T>(action: () => Promise<T>): Promise<T> => {
    const task = action(); active.add(task); void task.then(() => active.delete(task), () => active.delete(task)); return task;
  };
  const run = <T>(context: MemoryProviderCallContext, action: (call: MemoryProviderCallContext) => Promise<T>) =>
    track(() => action({ ...context, signal: context.signal ? AbortSignal.any([signal, context.signal]) : signal }));
  const settle = async () => { while (active.size > 0) await Promise.allSettled([...active]); };
  return { providerId: "hindsight", providerLineageId: state.epoch.providerLineageId, capabilities: () => track(state.capabilities),
    capabilitiesSnapshot: state.capabilitiesSnapshot,
    stop: () => { controller.abort(); return settle(); }, settle,
    retain: (context, request) => run(context, (call) => execute({ state, context: call, request, schema: RetainRequestSchema, action: (value) => {
      // The frozen retain schema does not preserve every special JSON own key.
      // Until an independent write adapter proves it, refuse before dispatch.
      if (!sameApplicationValue(request.metadata, value.metadata)) throw new Error("MEMORY_INVALID_REQUEST");
      return deps.writes.retain(call, value);
    } })),
    recall: (context, request) => run(context, (call) => {
      const mode = call.actor === "foreground-agent" || call.actor === "operator" ? "foreground" : undefined;
      return execute({ state, context: call, request, schema: RecallRequestSchema, mode,
        action: (value) => recallHindsightMemory(state, { context: call, request: value, mode }) });
    }),
    reflect: (context, request) => run(context, (call) => execute({ state, context: call, request, schema: ReflectRequestSchema,
      action: (value) => reflectHindsightMemory(state, { context: call, request: value }) })),
    mutate: (context, request) => run(context, (call) => execute({ state, context: call, request, schema: MutationRequestSchema,
      action: (value) => deps.writes.mutate(call, value) })),
  };
}

async function execute<TRequest extends { bankId: string }, TResult>(input: {
  state: HindsightMemoryProviderState; context: MemoryProviderCallContext; request: TRequest;
  schema: z.ZodType<TRequest>; action(request: TRequest): Promise<TResult>;
  mode?: "foreground";
}): Promise<MemoryResult<TResult>> {
  let capabilities: MemoryProviderCapabilities | null = null;
  try {
    input.state.assert(input.context);
    const parsed = input.schema.safeParse(input.request);
    if (!parsed.success) throw new Error("MEMORY_INVALID_REQUEST");
    const request = input.mode === "foreground" ? hindsightProviderCall(input.state,
      { context: input.context, bankId: parsed.data.bankId, mode: input.mode }) : undefined;
    capabilities = await input.state.capabilities(request);
    input.state.assert(input.context, parsed.data.bankId);
    const data = await input.action(parsed.data);
    input.state.assert(input.context, parsed.data.bankId);
    capabilities = await input.state.capabilities(request);
    return { ok: true, requestId: input.context.requestId, providerId: "hindsight",
      authorityEpochId: input.context.authorityEpochId, capabilities, data };
  } catch (error) { return hindsightProviderError({ context: input.context, capabilities, error }); }
}
