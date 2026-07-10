/**
 * INPUT:  onTurnCompleted(characterId) after each chat turn; injected timeline repo, auto-state repo, and writers
 * OUTPUT: createAutoMemory(deps) -> { onTurnCompleted } — detached episodic + flush passes, watermark-guarded
 * POS:    core/memory — the auto-write orchestrator (MEMORY-DESIGN §Write paths 2-3); never blocks the chat turn
 */
import { REPLAY_WINDOW } from "../agents/conversation-store.ts";
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { EpisodicWriter } from "./episodic-writer.ts";
import type { FlushWriter } from "./flush-writer.ts";

// Summarize into episodes once this many new messages have accrued since the last summary (config-later per prd §3).
const EPISODIC_EVERY_N = 20;

/** Narrow logger seam — pino's Logger satisfies it; tests pass a capturing double. Events carry ids/ranges, never content. */
export interface AutoMemoryLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface AutoMemory {
  /**
   * Fire-and-forget after a completed turn. Returns a promise (never rejects) that resolves when this trigger's
   * pass finishes — production ignores it (detached); tests await it. Passes serialize per character (mutex).
   */
  onTurnCompleted(characterId: string): Promise<void>;
}

export interface AutoMemoryDeps {
  timeline: TimelineRepo;
  autoState: MemoryAutoRepo;
  episodic: EpisodicWriter;
  flush: FlushWriter;
  logger: AutoMemoryLogger;
}

export function createAutoMemory(deps: AutoMemoryDeps): AutoMemory {
  // Per-character promise chain: a second trigger waits for the first, so it reads the advanced watermark (no double-fire).
  const chains = new Map<string, Promise<void>>();

  function onTurnCompleted(characterId: string): Promise<void> {
    const prev = chains.get(characterId) ?? Promise.resolve();
    // Defer to a macrotask so the just-finished chat turn returns to the caller before any auto-write work begins.
    const next = prev.then(() => new Promise<void>((resolve) => {
      setImmediate(() => void runPass(deps, characterId).then(resolve, resolve));
    }));
    chains.set(characterId, next);
    void next.finally(() => {
      if (chains.get(characterId) === next) chains.delete(characterId);
    });
    return next;
  }

  return { onTurnCompleted };
}

// A pass never throws (each sub-path is guarded) so the chain's catch is unreachable and the core never crashes.
async function runPass(deps: AutoMemoryDeps, characterId: string): Promise<void> {
  const latest = deps.timeline.latestSeq(characterId);
  await maybeEpisodic(deps, characterId, latest); // episodic before flush (prd §3 ordering); both may fire in one pass
  await maybeFlush(deps, characterId, latest);
}

async function maybeEpisodic(deps: AutoMemoryDeps, characterId: string, latest: number): Promise<void> {
  const { timeline, autoState, episodic, logger } = deps;
  const { lastEpisodicSeq } = autoState.get(characterId);
  if (latest - lastEpisodicSeq < EPISODIC_EVERY_N) return;
  const segment = timeline.rangeAscending(characterId, lastEpisodicSeq, latest);
  try {
    // Count only, never entryIds: their slugs are content-derived (memory-content leakage into logs — logging-guidelines).
    const { entryIds } = await episodic.summarize({ characterId, segment });
    autoState.setEpisodic(characterId, latest); // advance ONLY on success -> failure retries next trigger
    logger.info({ kind: "episodic", characterId, layer: "episodes", count: entryIds.length, from: lastEpisodicSeq, to: latest }, "episodic summary written");
  } catch (error) {
    logger.warn({ kind: "episodic", characterId, from: lastEpisodicSeq, to: latest, err: readable(error) }, "episodic summarization failed; will retry");
  }
}

async function maybeFlush(deps: AutoMemoryDeps, characterId: string, latest: number): Promise<void> {
  const { timeline, autoState, flush, logger } = deps;
  const { lastFlushSeq } = autoState.get(characterId);
  const through = latest - REPLAY_WINDOW; // the segment (lastFlushSeq, through] is leaving the model's window
  if (through <= lastFlushSeq) return;
  const segment = timeline.rangeAscending(characterId, lastFlushSeq, through);
  try {
    await flush.run({ characterId, segment });
    autoState.setFlush(characterId, through);
    logger.info({ kind: "flush", characterId, from: lastFlushSeq, through }, "pre-compaction flush completed");
  } catch (error) {
    logger.warn({ kind: "flush", characterId, from: lastFlushSeq, through, err: readable(error) }, "flush failed; will retry");
  }
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
