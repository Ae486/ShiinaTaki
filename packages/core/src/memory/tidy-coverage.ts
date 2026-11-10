/**
 * INPUT:  fresh scoped canonical rows/Blocks and exact reviewed revision checkpoints
 * OUTPUT: bounded report eligibility, accepted batch evidence and paced automatic admission
 * POS:    core/memory — Local tidy coverage policy; timestamps alone never establish reviewed content
 */
import type { MemoryConfig } from "../config/memory-config.ts";
import type { MemoryTidyReviewRepo, TidyCoverage } from "../db/memory-tidy-review-repo.ts";
import { V1_BLOCKS } from "./block-registry.ts";
import { parseCanonicalMemoryReference } from "./canonical-memory-view.ts";
import type { TidyEngineView } from "./memory-engine.ts";
import { estimateTokens } from "./token-estimator.ts";
import { buildTidyReport } from "./tidy-report.ts";
import { getLayer } from "./layer-registry.ts";
import { isPinnedEligible } from "./pinned-block.ts";

const DAY_MS = 86_400_000;

export function canonicalTidyReport(input: {
  view: TidyEngineView; coverage: TidyCoverage; characterId: string; lastTidyAt: string | null; config: MemoryConfig; nowMs?: number;
  candidateKeys?: Set<string>; reportTokenBudget?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const reviewed = new Map(input.coverage.memories.map((row) => [JSON.stringify([row.bankId, row.memoryId]), row]));
  const candidateIds = input.view.listActive(input.characterId).filter((row) => {
    const ref = parseCanonicalMemoryReference(row.id);
    const old = reviewed.get(JSON.stringify([ref.bankId, ref.memoryId]));
    if (!old || old.revision !== ref.expectedRevision) return true;
    const stale = nowMs - Date.parse(row.updatedAt ?? row.createdAt) > input.config.tidyStaleDays * DAY_MS;
    return stale && getLayer(row.layer)?.writePolicy !== "machine" && !isPinnedEligible(row)
      && nowMs - Date.parse(old.reviewedAt) > input.config.tidyStaleDays * DAY_MS;
  }).map((row) => row.id).filter((id) => input.candidateKeys === undefined || input.candidateKeys.has(tidyMemoryKey(id)));
  const capturedBlocks = new Map(input.view.blockRevisions?.(input.characterId).map((block) => [block.blockId, block.revision]) ?? []);
  const reviewedBlocks = new Map(input.coverage.blocks.map((block) => [block.blockId, block.revision]));
  const blockWork = V1_BLOCKS.some((block) => {
    const content = input.view.readBlock({ id: block.id, characterId: block.ownership === "per-character" ? input.characterId : undefined });
    return content !== undefined && estimateTokens(content) > block.budgetTokens
      && (capturedBlocks.get(block.id) === undefined || capturedBlocks.get(block.id) !== reviewedBlocks.get(block.id));
  });
  return buildTidyReport(input.view, { characterId: input.characterId, lastTidyAt: input.lastTidyAt, nowMs, candidateIds, blockWork,
    reportTokenBudget: input.reportTokenBudget }, input.config);
}

/** Stable admission identity; a later batch must read the current revision, not an obsolete reference. */
export function tidyMemoryKey(reference: string): string {
  const { bankId, memoryId } = parseCanonicalMemoryReference(reference);
  return JSON.stringify([bankId, memoryId]);
}

export function checkpointTidyBatch(input: {
  repo: MemoryTidyReviewRepo; view: TidyEngineView; characterId: string; shown: string[]; at: string; onCommitted?: () => void;
}): void {
  const refs = new Set([...input.shown, ...(input.view.resultingReferences?.() ?? [])]);
  const memories = [...refs].map((id) => {
    const { bankId, memoryId, expectedRevision } = parseCanonicalMemoryReference(id);
    return { bankId, memoryId, revision: expectedRevision };
  });
  input.repo.commit(input.characterId, { memories, blocks: input.view.blockRevisions?.() ?? [], at: input.at, onCommitted: input.onCommitted });
}

export function automaticTidyAllowed(input: { coverage: TidyCoverage; candidates: number; threshold: number; nowMs?: number }): boolean {
  const retry = input.coverage.retry;
  if (retry.failures > 0 && (retry.retryAt === null || Date.parse(retry.retryAt) > (input.nowMs ?? Date.now()))) return false;
  return retry.pending || input.candidates >= input.threshold;
}
