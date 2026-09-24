/**
 * INPUT:  the bound Hindsight epoch identity, the admitted Character and its persona cards
 * OUTPUT: createHindsightUnavailableRun() — an immutable memory-unavailable CapturedMemoryRun (no memory tools, no automatic
 *         recall, persona-only assembly, a prompt without the memory floor, all-false capability snapshot)
 * POS:    core/memory/hindsight — the degraded foreground capture under Hindsight authority; never a Local/Legacy fallback and
 *         never a network call; the Run keeps the provider/lineage/epoch identity it was admitted under
 */
import type { MemoryAuthorityEpoch, MemoryProviderCapabilities } from "@taki/shared";
import { BASE_SYSTEM_PROMPT } from "../../agents/base-prompt.ts";
import { captureCanonicalMemoryAssembly } from "../canonical-memory-assembly.ts";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import { createMemoryRunReference } from "../memory-capability-snapshot.ts";
import type { PersonaProvider } from "../persona-provider.ts";
import type { HindsightConnectionDrift } from "./hindsight-runtime-connection.ts";

export type HindsightUnavailableRunReason = Exclude<HindsightConnectionDrift, "none"> | "bank_not_ready" | "admission_unavailable";

const UNAVAILABLE_CAPABILITIES: MemoryProviderCapabilities = Object.freeze({ providerId: "hindsight", contractVersion: 1,
  retain: false, recall: false, reflect: false, edit: false, invalidate: false, restore: false, conditionalMutation: false,
  idempotentWrites: false, sparseRetrieval: false, vectorRetrieval: "unavailable", derivedMemoryRead: false });

// The base memory floor orders recall/retain calls this Run cannot make; identity, truthfulness and the injected-context
// contract still apply unchanged.
export const MEMORY_UNAVAILABLE_SYSTEM_PROMPT = withoutMemoryFloor(BASE_SYSTEM_PROMPT);

export function createHindsightUnavailableRun(input: {
  epoch: Pick<MemoryAuthorityEpoch, "epochId" | "providerLineageId">; characterId: string; persona: PersonaProvider;
}): CapturedMemoryRun {
  const snapshot = createMemoryRunReference({ providerId: "hindsight", providerLineageId: input.epoch.providerLineageId,
    authorityEpochId: input.epoch.epochId, contractVersion: 1, capabilities: UNAVAILABLE_CAPABILITIES });
  const assemble = captureCanonicalMemoryAssembly({ characterId: input.characterId, persona: input.persona, rows: [], blocks: "" });
  return Object.freeze({ snapshot, tools: Object.freeze({}), prompt: MEMORY_UNAVAILABLE_SYSTEM_PROMPT, assemble });
}

function withoutMemoryFloor(prompt: string): string {
  const start = prompt.indexOf("\n\nMemory (non-negotiable):"); const end = start < 0 ? -1 : prompt.indexOf("\n\n", start + 2);
  if (end < 0) throw new Error("MEMORY_INTEGRITY_ERROR: the base prompt memory section is not delimited");
  return prompt.slice(0, start) + prompt.slice(end);
}
