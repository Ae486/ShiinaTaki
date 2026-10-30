/**
 * INPUT:  the memory subsystem's retention ops, the intentions fallback window, a Logger (+ an injected clock)
 * OUTPUT: startRetentionSweeper(deps) -> { stop }; MemoryRetentionOps — one boot sweep plus the shared 6h interval
 * POS:    core/memory — T5-R8's enforcement arm and the layer registry's `retention` field's FIRST consumer. Decay
 *         means ARCHIVE (reversible, the file stays) everywhere except a rolling-window machine layer, which is the
 *         only sanctioned hard delete. Policy is registry DATA — this module adds no per-layer branches of its own
 */
import type { RetentionRow } from "../db/memory-repo.ts";
import type { Logger } from "../logging/logger.ts";
import { startSweeper, type SweepCounts } from "../scheduler/sweep-runner.ts";
import { V1_MEMORY_LAYERS, type MemoryLayerDefinition } from "./layer-registry.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

type Retention = MemoryLayerDefinition["retention"];
type Verdict = "keep" | "archive" | "delete";

/** The narrow store+index surface retention needs; the memory engine owns the wiring (its MemoryToolOps sibling). */
export interface MemoryRetentionOps {
  /** Every ACTIVE row of a layer, metadata only — the sweeper never reads a memory's content. */
  listActive(layer: string): RetentionRow[];
  /** Status flip: the file stays on disk, so a misjudged archive is recoverable (R8). */
  archive(path: string): void;
  /** File AND index row removed. Only a rolling-window layer may reach this. */
  hardDelete(path: string): void;
}

export interface RetentionSweeperDeps {
  ops: MemoryRetentionOps;
  /** How long an `intentions` row with no explicit `expires` may sit before it ages out (config, R13). */
  intentionsDefaultDays: number;
  logger: Logger;
  /** Injected epoch-ms clock (defaults to Date.now); tests pass a synthetic one. */
  now?: () => number;
  /** Optional authority gate; legacy retention must be silent after canonical cutover. */
  enabled?: () => boolean;
}

export function startRetentionSweeper(deps: RetentionSweeperDeps): { stop(): void } {
  const now = deps.now ?? Date.now;
  return startSweeper({
    name: "memory-retention",
    message: "memory retention swept",
    logger: deps.logger,
    enabled: deps.enabled,
    sweep: () => sweepOnce(deps, now()),
  });
}

function sweepOnce(deps: RetentionSweeperDeps, at: number): SweepCounts | undefined {
  let archived = 0;
  let deleted = 0;
  for (const layer of V1_MEMORY_LAYERS) {
    if (layer.retention === "permanent") continue; // a permanent layer is never even listed
    for (const row of deps.ops.listActive(layer.id)) {
      const verdict = memoryRetentionVerdict(layer.retention, row, { at, intentionsDefaultDays: deps.intentionsDefaultDays });
      if (verdict === "archive") {
        deps.ops.archive(row.path);
        archived += 1;
      } else if (verdict === "delete") {
        deps.ops.hardDelete(row.path);
        deleted += 1;
      }
    }
  }
  // Counts only, and only when something moved (logging-guidelines: no ids, no paths, no memory text).
  return archived + deleted > 0 ? { archived, deleted } : undefined;
}

interface SweepContext {
  at: number;
  intentionsDefaultDays: number;
}

/** Shared policy judgment; canonical adapters supply metadata and wait for their authoritative write themselves. */
export function memoryRetentionVerdict(retention: Retention, row: RetentionRow, ctx: SweepContext): Verdict {
  const age = ageMs(row, ctx.at);
  if (age === undefined) return "keep"; // a row we cannot date is a row we must not touch
  if (retention === "permanent") return "keep";
  if (retention === "expiring") return expiringVerdict(row, ctx, age);
  if ("rollingDays" in retention) {
    // The one hard delete (R8): machine-written, high-volume, zero sentimental value.
    return age > retention.rollingDays * DAY_MS ? "delete" : "keep";
  }
  return row.importance < retention.archiveBelowImportance && age > retention.afterDays * DAY_MS ? "archive" : "keep";
}

// An explicit `expires` is authoritative. Nothing sets one today, so a null-expiry row ages out on the configured
// window instead — without that fallback the expiring layer would never expire anything (batch-1 planning note 2).
function expiringVerdict(row: RetentionRow, ctx: SweepContext, age: number): Verdict {
  if (row.expiresAt !== null) {
    const expires = Date.parse(row.expiresAt);
    return Number.isNaN(expires) || expires > ctx.at ? "keep" : "archive";
  }
  return age > ctx.intentionsDefaultDays * DAY_MS ? "archive" : "keep";
}

// R9: a reinforcement refreshes recency, so a reinforced row must not decay on its birth date.
function ageMs(row: RetentionRow, at: number): number | undefined {
  const anchor = Date.parse(row.updatedAt ?? row.createdAt);
  return Number.isNaN(anchor) ? undefined : at - anchor;
}
