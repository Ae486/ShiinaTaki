/**
 * INPUT:  provider-neutral coordinator, trusted Character routes, and admission-bound prompt projection
 * OUTPUT: one immutable executable memory bundle for Harness admission and every foreground attempt
 * POS:    core/memory — shared Local/Hindsight run binding; contains no storage, activation, or provider fallback
 */
import type { ToolSet } from "ai";
import type { RunMemoryReference } from "@taki/shared";
import type { MemoryCoordinatorRuntime } from "./memory-coordinator.ts";
import { createCanonicalMemoryToolsWithCapabilities, type MemoryToolBankRouter } from "./canonical-tools/canonical-memory-tools.ts";
import { createAutomaticMemoryRecall, type AutomaticMemoryRecall, type AutomaticMemoryRecallConfig,
  type AutomaticMemoryRecallDiagnostic } from "./automatic-memory-recall.ts";

export interface CapturedMemoryRun {
  readonly snapshot: RunMemoryReference;
  readonly tools: ToolSet;
  readonly automaticRecall?: AutomaticMemoryRecall;
  readonly prompt?: string;
  readonly assemble?: (currentMessage: string) => string;
}

export async function createCanonicalMemoryRun(input: {
  coordinator: MemoryCoordinatorRuntime;
  router: MemoryToolBankRouter;
  prompt?: string;
  assemble?: (currentMessage: string) => string;
  recallConfig?: Partial<AutomaticMemoryRecallConfig>;
  onRecallDiagnostic?: (diagnostic: AutomaticMemoryRecallDiagnostic) => void;
}): Promise<CapturedMemoryRun> {
  // Freeze routes before the asynchronous capability read; a later selection change cannot redirect this Run.
  const global = input.router.globalBankId(); const character = input.router.characterBankId(); const characterId = input.router.characterId();
  const router = Object.freeze({ globalBankId: () => global, characterBankId: () => character, characterId: () => characterId });
  const captured = await input.coordinator.captureRun();
  const tools = createCanonicalMemoryToolsWithCapabilities({ coordinator: captured.coordinator,
    router, authority: captured.authority }, captured.snapshot.capabilities);
  return Object.freeze({ snapshot: captured.snapshot, tools, prompt: input.prompt, assemble: input.assemble,
    automaticRecall: createAutomaticMemoryRecall({ coordinator: captured.coordinator, snapshot: captured.snapshot,
      router, config: input.recallConfig, onDiagnostic: input.onRecallDiagnostic }) });
}
