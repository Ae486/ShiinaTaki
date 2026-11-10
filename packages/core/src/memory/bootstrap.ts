/**
 * INPUT:  the open Database, the data/prompt dirs, the MAIN model, the timeline repo, the window boundary, the
 *         optional shared Utility Slot, process env, a Logger
 * OUTPUT: createMemorySubsystem(deps) -> Legacy engine, provider maintenance, flush adapter, tidy/write surfaces
 * POS:    core/memory — the subsystem's BOOT wiring, lifted out of the composition root: memory config, persona
 *         cards, block store, engine + startup reconcile, the utility slot every background pass runs on, the
 *         provider maintenance, the tidy pass, flush adapter and retention sweeper. Core owns Compaction composition
 */
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { loadUtilityConfig } from "../config/utility-config.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { Logger } from "../logging/logger.ts";
import { createAutoMemoryMaintenance, type AutoMemoryMaintenance } from "./auto-memory.ts";
import { createBlockStore } from "./block-store.ts";
import { createEpisodicWriter, type MemoryWriteOp } from "./episodic-writer.ts";
import { createFlushWriter } from "./flush-writer.ts";
import { createLegacyMemoryFlushPort, type MemoryFlushPort } from "./memory-flush-port.ts";
import { createMemoryEngine, type MemoryEngine } from "./memory-engine.ts";
import { createPersonaProvider } from "./persona-provider.ts";
import { startRetentionSweeper } from "./retention-sweeper.ts";
import { createTidyPass, type TidyPass } from "./tidy-pass.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { fenceMemoryEngine } from "./legacy-migration/fenced-memory-engine.ts";
import type { MemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";

export interface MemorySubsystemDeps {
  db: Database;
  dataDir: string;
  promptDir: string;
  /** The MAIN chat model — the utility slot's fallback when no separate background slot is configured. */
  model: LanguageModel;
  /** Core composition injects the one process-wide Utility Slot; tests may omit it and use the legacy factory. */
  utility?: UtilitySlot;
  timeline: TimelineRepo;
  /** The conversation store's replay boundary — the flush computes "leaving the window" from it (batch 6). */
  windowStart: (characterId: string) => number;
  env: Record<string, string | undefined>;
  logger: Logger;
  authorityFence?: MemoryAuthorityFence;
  /** Runtime authority state used to retire the legacy retention arm after canonical activation. */
  isCanonical?: () => boolean;
  /** Automatic tidy keeps its trigger but admits work through the same durable operation owner. */
  requestTidyRun?: (characterId: string) => Promise<void>;
}

export interface MemorySubsystem {
  engine: MemoryEngine;
  /** Legacy-only episodic/flush/tidy work; Core schedules it before provider-neutral Compaction. */
  maintenance: AutoMemoryMaintenance;
  /** Legacy pre-retirement adapter over the same watermark-guarded FlushWriter used by ordinary maintenance. */
  memoryFlush: MemoryFlushPort;
  /** The background model slot + its serial queue and cumulative spend (T5-R11). */
  utility: UtilitySlot;
  /** The store-maintenance pass (batch 4b); runNow is the WS memory.tidy surface. */
  tidy: TidyPass;
  /** The entry tree's root; media.usage reports its byte footprint (D27). */
  memoryRoot: string;
  /** The bound write op the image-description bridge reuses (#17 decision 6). */
  writeMemory(input: Parameters<MemoryWriteOp>[0]): { id: string };
  stop?(): void | Promise<void>;
}

export function createMemorySubsystem(deps: MemorySubsystemDeps): MemorySubsystem {
  const { db, logger, timeline } = deps;
  const config = loadMemoryConfig(deps.env);
  // Every background pass takes this model, so moving background work onto a cheaper provider is ONE env change.
  const utility = deps.utility ?? createUtilitySlot({ mainModel: deps.model, config: loadUtilityConfig(deps.env), logger });
  const rawEngine = buildEngine(deps, config);
  const engine = deps.authorityFence ? fenceMemoryEngine(rawEngine, deps.authorityFence) : rawEngine;
  const autoState = createMemoryAutoRepo(db);
  const events = createMemoryEventsRepo(db);

  // The tidy pass (batch 4b): model-led store maintenance on the utility slot. Its write-count trigger rides
  // auto-memory's per-character chain below; the WS memory.tidy method drives runNow directly.
  const tidy = createTidyPass({
    view: engine.tidy,
    autoState,
    events,
    slot: utility,
    config,
    logger: logger.child({ mod: "memory-tidy" }),
    requestRun: deps.requestTidyRun,
  });

  // Automatic memory writes (#7): episodic summaries + pre-compaction flush, fired detached after each chat turn.
  // All writes ride the engine's store API (never raw fs) through ONE bound op — the writer chooses the layer
  // (T5 Q11-1), so the binding no longer pins one.
  const writeMemory: MemorySubsystem["writeMemory"] = ({ layer, ...rest }) => engine.writeEntry({ ...rest, type: layer });
  // ONE flush writer instance: auto-memory's leaving-the-window trigger and the compactor's flush-before-retire
  // step must share the watermark-guarded path, or the same span could be judged twice (batch 7 §3.2).
  const flush = createFlushWriter({ model: utility.model, createTools: (id) => engine.createBackgroundTools(id), slot: utility });
  const rawMaintenance = createAutoMemoryMaintenance({
    timeline,
    autoState,
    events,
    episodic: createEpisodicWriter({ model: utility.model, writeMemory }),
    flush,
    utility,
    tidy,
    windowStart: deps.windowStart,
    logger: logger.child({ mod: "memory-auto" }),
  });
  const authorityFence = deps.authorityFence;
  const maintenance = authorityFence
    ? { run: (characterId: string, origin: Parameters<AutoMemoryMaintenance["run"]>[1]) =>
        authorityFence.admit(() => rawMaintenance.run(characterId, origin)) }
    : rawMaintenance;
  const memoryFlush = createLegacyMemoryFlushPort({
    timeline,
    autoState,
    writer: flush,
    fence: deps.authorityFence,
  });

  // T5-R8: the layer registry's `retention` field finally gets its consumer — boot sweep + 6h, counts-only log.
  const retention = startRetentionSweeper({
    ops: engine.retention,
    intentionsDefaultDays: config.intentionsDefaultDays,
    logger,
    enabled: () => !(deps.isCanonical?.() ?? false),
  });

  return { engine, maintenance, memoryFlush, utility, tidy, memoryRoot: memoryRootOf(deps.dataDir), writeMemory,
    stop: async () => { retention.stop(); await tidy.stop(); } };
}

// The Workspace's memory tree: markdown files under the app data root (beside the db, NOT in it — invariant 1).
function memoryRootOf(dataDir: string): string {
  return join(dataDir, "workspace", "memory");
}

function buildEngine(deps: MemorySubsystemDeps, config: ReturnType<typeof loadMemoryConfig>): MemoryEngine {
  const memoryLog = deps.logger.child({ mod: "memory" });
  // Persona cards (#16): the global assistant layer + per-character persona, read from prompt/ at boot and injected
  // FIRST in the assembled turn context (prompt/README.md order). A missing card degrades to a built-in fallback.
  const persona = createPersonaProvider({ promptDir: deps.promptDir, logger: deps.logger });
  // Memory Blocks (T5 Q7): the always-visible tier — pure markdown BESIDE the entry tree, so the FTS index can never
  // ingest one; `blocks/global/user-card.md` is the user's hand-edited identity card, re-read on every turn.
  const blocks = createBlockStore({ root: join(deps.dataDir, "workspace", "blocks") });
  const engine = createMemoryEngine({
    db: deps.db,
    memoryRoot: memoryRootOf(deps.dataDir),
    persona,
    blocks,
    config,
    timeline: deps.timeline,
  });
  // Startup reconciliation rebuilds the derived index from those files (files are truth).
  const reconciled = engine.reconcile();
  memoryLog.info(reconciled, "memory index reconciled from workspace");
  if (reconciled.invalid.length > 0)
    memoryLog.warn({ invalid: reconciled.invalid }, "invalid memory files skipped (fix or remove them)");
  return engine;
}
