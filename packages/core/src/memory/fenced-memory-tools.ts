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
  /** A durable typed provider adapter owns these calls while a transition fence is closed. */
  canQueue?: () => boolean;
}

/** A refusal is a structured result the model can read and retry, never a thrown error. */
export function fenceMemoryToolWrites(tools: ToolSet, fence: CanonicalLocalWriteFence, policy: FencedToolPolicy): ToolSet {
  return Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!execute) return [name, definition];
    const fenced: Tool = { ...definition, execute: async (toolInput: unknown, options: Parameters<typeof execute>[1]) => {
      // Read consumers retain their own immutable runtime lifetime and response envelope. A generic write-fence
      // response would corrupt that contract and mask their post-stop cancellation before reaching the provider.
      if (policy.open.has(name)) return execute(toolInput, options);
      try { fence.assertAlive(); } catch { return policy.refusal; }
      // Decide before dispatch. A child refusal after an admitted write may follow a real effect; catching that
      // failure and invoking the tool again would create a second queue obligation for an uncertain first action.
      if (!fence.writable() && policy.canQueue?.() && memoryEffectMetadata(definition)) return execute(toolInput, options);
      try { return await fence.admit(async () => await execute(toolInput, options)); }
      catch (error) {
        if (!isCanonicalLocalFenced(error)) throw error;
        return policy.refusal;
      }
    } };
    // The spread drops the non-enumerable Effect metadata governance keys on; reattach the same frozen identity.
    const metadata = memoryEffectMetadata(definition);
    return [name, Object.freeze(metadata ? attachMemoryEffectMetadata(fenced, metadata) : fenced)];
  })));
}
