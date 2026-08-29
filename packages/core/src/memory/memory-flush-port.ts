/**
 * INPUT:  a compaction retirement range and the active Memory Provider flush contract
 * OUTPUT: typed pre-retirement outcomes plus Legacy/Local/unavailable adapters and a switchable binding
 * POS:    core/memory — provider boundary used by Core-owned Compaction; never owns summary or Timeline state
 */
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { FlushWriter } from "./flush-writer.ts";
import type { MemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";

export interface MemoryFlushRequest {
  characterId: string;
  fromSeq: number;
  throughSeq: number;
  operationId: string;
}

export type MemoryFlushOutcome =
  | { status: "success"; writes: number; throughSeq: number }
  | { status: "not_required"; reason: "canonical_local_records_are_authoritative" }
  | { status: "retryable_failure"; code: "LEGACY_FLUSH_FAILED" | "MEMORY_AUTHORITY_FENCED" | "MEMORY_FLUSH_INCOMPLETE" | "MEMORY_FLUSH_FAILED" }
  | { status: "permanent_unavailable"; code: "HINDSIGHT_RUNTIME_UNAVAILABLE" };

export interface MemoryFlushPort {
  prepareRetirement(input: MemoryFlushRequest): Promise<MemoryFlushOutcome>;
}

export interface MemoryFlushBinding {
  port: MemoryFlushPort;
  bind(next: MemoryFlushPort): void;
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

export function canonicalLocalMemoryFlushPort(): MemoryFlushPort {
  return {
    prepareRetirement: async () => ({
      status: "not_required",
      reason: "canonical_local_records_are_authoritative",
    }),
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

export function createMemoryFlushBinding(initial: MemoryFlushPort): MemoryFlushBinding {
  let current = initial;
  return {
    port: { prepareRetirement: (input) => current.prepareRetirement(input) },
    bind(next) {
      current = next;
    },
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
