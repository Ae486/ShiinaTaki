/**
 * INPUT:  onTurnCompleted(characterId, origin) after each turn; injected timeline/auto-state/events repos, writers,
 *         the conversation store's window boundary and the optional tidy/compact hooks
 * OUTPUT: createAutoMemory(deps) -> { onTurnCompleted } — detached episodic + flush passes (watermark-guarded),
 *         then tidy, then compaction, all in one per-character chain
 * POS:    core/memory — the auto-write orchestrator (MEMORY-DESIGN §Write paths 2-3); never blocks the chat turn
 */
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { MemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { EpisodicWriter } from "./episodic-writer.ts";
import type { FlushWriter } from "./flush-writer.ts";
import type { UtilitySlot } from "./utility-slot.ts";

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

/** The tidy pass's trigger seam (batch 4b fills it): it decides for itself whether this turn earns a pass. */
export interface AutoMemoryTidy {
  maybeRun(characterId: string): Promise<void>;
}

/** The compaction pass's trigger seam (batch 7b fills it): same self-deciding shape as tidy, runs LAST. */
export interface AutoMemoryCompact {
  maybeRun(characterId: string): Promise<void>;
}

export interface AutoMemory {
  /**
   * Fire-and-forget after a completed turn. Returns a promise (never rejects) that resolves when this trigger's
   * pass finishes — production ignores it (detached); tests await it. Passes serialize per character (mutex).
   */
  onTurnCompleted(characterId: string, origin?: TurnOrigin): Promise<void>;
}

/** Provider-specific memory work that runs before provider-neutral Compaction in the shared Character chain. */
export interface AutoMemoryMaintenance {
  run(characterId: string, origin: TurnOrigin): Promise<void>;
}

export interface AutoMemoryDeps {
  timeline: TimelineRepo;
  autoState: MemoryAutoRepo;
  events: MemoryEventsRepo;
  episodic: EpisodicWriter;
  flush: FlushWriter;
  /** Optional process-wide queue for provider calls; production injects the shared Utility Slot. */
  utility?: UtilitySlot;
  logger: AutoMemoryLogger;
  /**
   * The conversation store's window boundary (seq of the oldest replayed entry): the flush treats every row below
   * it as having left the model's window — the SAME selectWindow boundary history() replays, so flush and replay
   * cannot drift apart (batch 6 coupling point 2).
   */
  windowStart: (characterId: string) => number;
  /**
   * OPTIONAL store-maintenance hook, run after the write passes inside the SAME per-character chain — so the tidy
   * pass reads a store the writers have finished with, and needs no mutex of its own. Absent = today's behavior.
   */
  tidy?: AutoMemoryTidy;
  /**
   * OPTIONAL compaction hook, run LAST in the same chain (episodic → flush → tidy → compact): the compactor
   * re-runs the flush over its retiring span, so it must see watermarks this pass has finished advancing.
   * Absent = today's behavior byte-identical.
   */
  compact?: AutoMemoryCompact;
}

export function createAutoMemory(deps: AutoMemoryDeps): AutoMemory {
  const maintenance = createAutoMemoryMaintenance(deps);
  return createMaintenanceAutoMemory({ maintenance: () => maintenance, compact: deps.compact, logger: deps.logger });
}

export function createAutoMemoryMaintenance(deps: Omit<AutoMemoryDeps, "compact">): AutoMemoryMaintenance {
  return { run: (characterId, origin) => runMaintenancePass(deps, characterId, origin) };
}

export function createMaintenanceAutoMemory(input: {
  maintenance: () => AutoMemoryMaintenance | undefined;
  compact?: AutoMemoryCompact;
  logger: AutoMemoryLogger;
}): AutoMemory {
  // Per-character promise chain: a second trigger waits for the first, so it reads the advanced watermark (no double-fire).
  const chains = new Map<string, Promise<void>>();

  function onTurnCompleted(characterId: string, origin: TurnOrigin = "primary"): Promise<void> {
    const prev = chains.get(characterId) ?? Promise.resolve();
    // Defer to a macrotask so the just-finished chat turn returns to the caller before any auto-write work begins.
    const next = prev.then(() => new Promise<void>((resolve) => {
      setImmediate(() => void runMaintenanceChain(input, characterId, origin).then(resolve, resolve));
    }));
    chains.set(characterId, next);
    void next.finally(() => {
      if (chains.get(characterId) === next) chains.delete(characterId);
    });
    return next;
  }

  return { onTurnCompleted };
}

async function runMaintenanceChain(
  input: { maintenance: () => AutoMemoryMaintenance | undefined; compact?: AutoMemoryCompact; logger: AutoMemoryLogger },
  characterId: string,
  origin: TurnOrigin,
): Promise<void> {
  try {
    await input.maintenance()?.run(characterId, origin);
  } catch (error) {
    // The provider pass is detached; keep this outer guard bounded even if a future adapter throws an unsanitized
    // exception outside its own sub-path.
    input.logger.warn({ kind: "provider", characterId, code: maintenanceFailureCode(error) }, "memory provider maintenance failed; will retry");
  }
  await maybeCompact({ compact: input.compact, logger: input.logger }, characterId);
}

// A provider pass never throws (each sub-path is guarded) so the outer coordinator remains detached and reusable.
async function runMaintenancePass(deps: Omit<AutoMemoryDeps, "compact">, characterId: string, origin: TurnOrigin): Promise<void> {
  const latest = deps.timeline.latestSeq(characterId);
  await maybeEpisodic(deps, { characterId, origin, latest }); // episodic before flush (prd §3); both may fire in one pass
  await maybeFlush(deps, { characterId, origin, latest });
  await maybeTidy(deps, characterId);
}

// Maintenance runs LAST: it judges the store this pass just wrote into. Its own failure is swallowed here for the
// same reason the write passes swallow theirs — background upkeep must never surface on a chat turn.
async function maybeTidy(deps: AutoMemoryDeps, characterId: string): Promise<void> {
  if (!deps.tidy) return;
  try {
    await deps.tidy.maybeRun(characterId);
  } catch (error) {
    deps.logger.warn({ kind: "tidy", characterId, err: readable(error) }, "tidy pass failed; will retry");
  }
}

// Compaction runs after even tidy (batch 7): it retires conversation the flush above has finished judging, and its
// own flush-before-retire step must read the watermark this pass just advanced. Failure = warn + retry next trigger.
async function maybeCompact(
  deps: { compact?: AutoMemoryCompact; logger: AutoMemoryLogger },
  characterId: string,
): Promise<void> {
  if (!deps.compact) return;
  try {
    await deps.compact.maybeRun(characterId);
  } catch (error) {
    deps.logger.warn({ kind: "compact", characterId, err: readable(error) }, "compaction pass failed; will retry");
  }
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
    const result = deps.utility
      ? await deps.utility.run("episodic", () => episodic.summarize({ characterId, segment }))
      : await episodic.summarize({ characterId, segment });
    if (!result) throw new Error("MEMORY_PROVIDER_MAINTENANCE_FAILED");
    const { entryIds } = result;
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
  const { characterId, origin } = ctx;
  const { lastFlushSeq } = autoState.get(characterId);
  // Everything below the store's replay boundary has left the model's window — the segment (lastFlushSeq, through]
  // is exactly what history() no longer shows (batch 6: same selectWindow slice, no drift window).
  const through = deps.windowStart(characterId) - 1;
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

function maintenanceFailureCode(error: unknown): "MEMORY_AUTHORITY_FENCED" | "MEMORY_PROVIDER_MAINTENANCE_FAILED" {
  return error instanceof Error && error.message === "MEMORY_AUTHORITY_FENCED"
    ? "MEMORY_AUTHORITY_FENCED"
    : "MEMORY_PROVIDER_MAINTENANCE_FAILED";
}
