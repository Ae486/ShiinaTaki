/**
 * INPUT:  a memory ToolSet, a write fence and the policy naming the open read tools plus the model-facing refusal
 * OUTPUT: fenceMemoryToolWrites() — write tools admitted through the fence; a fenced call returns the bounded refusal
 * POS:    core/memory — shared by the Local (activation) and Hindsight (backup) writer fences; Effect metadata identity kept
 */
import type { Tool, ToolSet } from "ai";
import { isCanonicalLocalFenced, type CanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { attachMemoryEffectMetadata, memoryEffectMetadata } from "./canonical-tools/memory-effect-tool.ts";

export interface FencedToolPolicy {
  open: ReadonlySet<string>;
  refusal: Readonly<{ ok: false; code: "MEMORY_AUTHORITY_FENCED"; message: string }>;
}

/** A refusal is a structured result the model can read and retry, never a thrown error. */
export function fenceMemoryToolWrites(tools: ToolSet, fence: CanonicalLocalWriteFence, policy: FencedToolPolicy): ToolSet {
  return Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!execute || policy.open.has(name)) return [name, definition];
    const fenced: Tool = { ...definition, execute: async (toolInput: unknown, options: Parameters<typeof execute>[1]) => {
      try { return await fence.admit(async () => await execute(toolInput, options)); }
      catch (error) { if (isCanonicalLocalFenced(error)) return policy.refusal; throw error; }
    } };
    // The spread drops the non-enumerable Effect metadata governance keys on; reattach the same frozen identity.
    const metadata = memoryEffectMetadata(definition);
    return [name, Object.freeze(metadata ? attachMemoryEffectMetadata(fenced, metadata) : fenced)];
  })));
}
