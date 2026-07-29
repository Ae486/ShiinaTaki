/**
 * INPUT:  onTurnCompleted(characterId, origin) after each turn; injected timeline/auto-state/events repos and writers
 * OUTPUT: createAutoMemory(deps) -> { onTurnCompleted } — detached episodic + flush passes, watermark-guarded
 * POS:    core/memory — the auto-write orchestrator (MEMORY-DESIGN §Write paths 2-3); never blocks the chat turn
 */
import { REPLAY_WINDOW } from "../agents/conversation-store.ts";
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { MemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { EpisodicWriter } from "./episodic-writer.ts";
import type { FlushWriter } from "./flush-writer.ts";

// Summarize into episodes once this many new messages have accrued since the last summary (config-later per prd §3).
const EPISODIC_EVERY_N = 20;

/**
 * What kind of turn triggered this pass (M-A2 seam). T5 only carries the value; T4 gives heartbeat turns their own
 * origin so their writes can be told apart from a real conversation's.
 */
export type TurnOrigin = "primary" | "heartbeat" | "flush" | "subagent";

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
  onTurnCompleted(characterId: string, origin?: TurnOrigin): Promise<void>;
}

export interface AutoMemoryDeps {
  timeline: TimelineRepo;
  autoState: MemoryAutoRepo;
  events: MemoryEventsRepo;
  episodic: EpisodicWriter;
  flush: FlushWriter;
  logger: AutoMemoryLogger;
}

export function createAutoMemory(deps: AutoMemoryDeps): AutoMemory {
  // Per-character promise chain: a second trigger waits for the first, so it reads the advanced watermark (no double-fire).
  const chains = new Map<string, Promise<void>>();

  function onTurnCompleted(characterId: string, origin: TurnOrigin = "primary"): Promise<void> {
    const prev = chains.get(characterId) ?? Promise.resolve();
    // Defer to a macrotask so the just-finished chat turn returns to the caller before any auto-write work begins.
    const next = prev.then(() => new Promise<void>((resolve) => {
      setImmediate(() => void runPass(deps, characterId, origin).then(resolve, resolve));
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
async function runPass(deps: AutoMemoryDeps, characterId: string, origin: TurnOrigin): Promise<void> {
  const latest = deps.timeline.latestSeq(characterId);
  await maybeEpisodic(deps, { characterId, origin, latest }); // episodic before flush (prd §3); both may fire in one pass
  await maybeFlush(deps, { characterId, origin, latest });
}

interface PassContext {
  characterId: string;
  origin: TurnOrigin;
  latest: number;
}

async function maybeEpisodic(deps: AutoMemoryDeps, ctx: PassContext): Promise<void> {
  const { timeline, autoState, episodic, events, logger } = deps;
  const { characterId, origin, latest } = ctx;
  const { lastEpisodicSeq } = autoState.get(characterId);
  if (latest - lastEpisodicSeq < EPISODIC_EVERY_N) return;
  const segment = timeline.rangeAscending(characterId, lastEpisodicSeq, latest);
  try {
    // Count only, never entryIds: their slugs are content-derived (memory-content leakage into logs — logging-guidelines).
    const { entryIds } = await episodic.summarize({ characterId, segment });
    autoState.setEpisodic(characterId, latest); // advance ONLY on success -> failure retries next trigger
    // T5-R15 makes silence the normal outcome, so a silent skip MUST leave a trace — otherwise "nothing was worth
    // writing" and "the writer is broken" look identical (mem0 issue #3009).
    if (entryIds.length === 0) events.record({ kind: "skip", characterId, turnSeq: latest });
    logger.info({ kind: "episodic", characterId, origin, count: entryIds.length, from: lastEpisodicSeq, to: latest }, "episodic summary written");
  } catch (error) {
    logger.warn({ kind: "episodic", characterId, origin, from: lastEpisodicSeq, to: latest, err: readable(error) }, "episodic summarization failed; will retry");
  }
}

async function maybeFlush(deps: AutoMemoryDeps, ctx: PassContext): Promise<void> {
  const { timeline, autoState, flush, events, logger } = deps;
  const { characterId, origin, latest } = ctx;
  const { lastFlushSeq } = autoState.get(characterId);
  const through = latest - REPLAY_WINDOW; // the segment (lastFlushSeq, through] is leaving the model's window
  if (through <= lastFlushSeq) return;
  const segment = timeline.rangeAscending(characterId, lastFlushSeq, through);
  try {
    const { writes } = await flush.run({ characterId, segment });
    autoState.setFlush(characterId, through);
    // Same reason as the episodic skip: after T5-R15 a flush that keeps nothing is the expected case, so it has to
    // leave a trace of its own or the two halves of the write gate are not equally observable.
    if (writes === 0) events.record({ kind: "skip", characterId, turnSeq: through });
    logger.info({ kind: "flush", characterId, origin, writes, from: lastFlushSeq, through }, "pre-compaction flush completed");
  } catch (error) {
    logger.warn({ kind: "flush", characterId, origin, from: lastFlushSeq, through, err: readable(error) }, "flush failed; will retry");
  }
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
