/**
 * INPUT:  a compaction retirement range and the active Memory Provider flush contract
 * OUTPUT: typed pre-retirement outcomes plus receipt-guarded Legacy/Local adapters and a switchable binding
 * POS:    core/memory — provider boundary used by Core-owned Compaction; never owns summary or Timeline state
 */
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { FlushWriter } from "./flush-writer.ts";
import type { MemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import type { IngestionCoverageGap } from "./canonical-ingestion-source.ts";

export interface MemoryFlushRequest {
  characterId: string;
  fromSeq: number;
  throughSeq: number;
  operationId: string;
}

export type MemoryFlushOutcome =
  | { status: "success"; writes: number; throughSeq: number }
  | { status: "not_required"; reason: "canonical_local_records_are_authoritative" | "before_canonical_ingestion_eligibility" }
  | { status: "retryable_failure"; code: "LEGACY_FLUSH_FAILED" | "MEMORY_AUTHORITY_FENCED" | "MEMORY_FLUSH_INCOMPLETE" | "MEMORY_FLUSH_FAILED" }
  | { status: "permanent_unavailable"; code: "HINDSIGHT_RUNTIME_UNAVAILABLE" };

export interface MemoryFlushPort {
  prepareRetirement(input: MemoryFlushRequest): Promise<MemoryFlushOutcome>;
}

export function createLegacyMemoryFlushPort(input: {
  timeline: TimelineRepo;
  autoState: MemoryAutoRepo;
  writer: FlushWriter;
  fence?: MemoryAuthorityFence;
}): MemoryFlushPort {
  return {
    prepareRetirement: (request) => runLegacyFlush(input, request),
  };
}

export interface CanonicalMemoryIngestionRunner {
  run(input: { characterId: string; throughSeq: number }): Promise<{
    writes: number; throughSeq: number; eligibilityStartSeq?: number; hasApplicableSource?: boolean;
    coverageGap?: IngestionCoverageGap;
  }>;
}

export function canonicalLocalMemoryFlushPort(ingestion?: CanonicalMemoryIngestionRunner): MemoryFlushPort {
  return {
    async prepareRetirement(request) {
      if (!ingestion) return { status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" };
      try {
        const result = await ingestion.run({ characterId: request.characterId, throughSeq: request.throughSeq });
        if (!Number.isSafeInteger(result.throughSeq) || result.throughSeq < 0
          || !Number.isSafeInteger(result.writes) || result.writes < 0) {
          return { status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" };
        }
        // A baseline excludes old history, but cannot release an unsettled trusted custody group.
        if (result.coverageGap) return { status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" };
        if (result.eligibilityStartSeq !== undefined && request.throughSeq < result.eligibilityStartSeq && !result.hasApplicableSource) {
          return { status: "not_required", reason: "before_canonical_ingestion_eligibility" };
        }
        const covered = Math.max(result.throughSeq, (result.eligibilityStartSeq ?? 1) - 1);
        if (covered < request.throughSeq) return { status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" };
        return { status: "success", writes: result.writes, throughSeq: Math.max(result.throughSeq, request.throughSeq) };
      } catch (error) {
        const code = readable(error);
        return { status: "retryable_failure", code: code === "MEMORY_AUTHORITY_MISMATCH" || code === "MEMORY_AUTHORITY_FENCED"
          ? "MEMORY_AUTHORITY_FENCED" : "MEMORY_FLUSH_INCOMPLETE" };
      }
    },
  };
}

export function unavailableHindsightMemoryFlushPort(): MemoryFlushPort {
  return {
    prepareRetirement: async () => ({
      status: "permanent_unavailable",
      code: "HINDSIGHT_RUNTIME_UNAVAILABLE",
    }),
  };
}

async function runLegacyFlush(
  input: {
    timeline: TimelineRepo;
    autoState: MemoryAutoRepo;
    writer: FlushWriter;
    fence?: MemoryAuthorityFence;
  },
  request: MemoryFlushRequest,
): Promise<MemoryFlushOutcome> {
  const run = async (): Promise<MemoryFlushOutcome> => {
    const lastFlushSeq = input.autoState.get(request.characterId).lastFlushSeq;
    if (request.throughSeq <= lastFlushSeq) {
      return { status: "success", writes: 0, throughSeq: lastFlushSeq };
    }
    const segment = input.timeline.rangeAscending(request.characterId, lastFlushSeq, request.throughSeq);
    try {
      const result = await input.writer.run({ characterId: request.characterId, segment });
      input.autoState.setFlush(request.characterId, request.throughSeq);
      return { status: "success", writes: result.writes, throughSeq: request.throughSeq };
    } catch (error) {
      return {
        status: "retryable_failure",
        code: readable(error) === "MEMORY_AUTHORITY_FENCED" ? "MEMORY_AUTHORITY_FENCED" : "LEGACY_FLUSH_FAILED",
      };
    }
  };
  if (!input.fence) return run();
  try {
    return await input.fence.admit(run);
  } catch (error) {
    return {
      status: "retryable_failure",
      code: readable(error) === "MEMORY_AUTHORITY_FENCED" ? "MEMORY_AUTHORITY_FENCED" : "LEGACY_FLUSH_FAILED",
    };
  }
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
