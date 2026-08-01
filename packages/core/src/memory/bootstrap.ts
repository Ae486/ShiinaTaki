/**
 * INPUT:  the open Database, the data/prompt dirs, the MAIN model, the timeline repo, process env, a Logger
 * OUTPUT: createMemorySubsystem(deps) -> { engine, autoMemory, utility, tidy, memoryRoot, writeMemory }
 * POS:    core/memory — the subsystem's BOOT wiring, lifted out of the composition root: memory config, persona
 *         cards, block store, engine + startup reconcile, the utility slot every background pass runs on, the
 *         auto-write orchestrator, the tidy pass, and the retention sweeper. main.ts keeps one call
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
import { createAutoMemory, type AutoMemory } from "./auto-memory.ts";
import { createBlockStore } from "./block-store.ts";
import { createEpisodicWriter, type MemoryWriteOp } from "./episodic-writer.ts";
import { createFlushWriter } from "./flush-writer.ts";
import { createMemoryEngine, type MemoryEngine } from "./memory-engine.ts";
import { createPersonaProvider } from "./persona-provider.ts";
import { startRetentionSweeper } from "./retention-sweeper.ts";
import { createTidyPass, type TidyPass } from "./tidy-pass.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";

export interface MemorySubsystemDeps {
  db: Database;
  dataDir: string;
  promptDir: string;
  /** The MAIN chat model — the utility slot's fallback when no separate background slot is configured. */
  model: LanguageModel;
  timeline: TimelineRepo;
  /** The conversation store's replay boundary — the flush computes "leaving the window" from it (batch 6). */
  windowStart: (characterId: string) => number;
  env: Record<string, string | undefined>;
  logger: Logger;
}

export interface MemorySubsystem {
  engine: MemoryEngine;
  autoMemory: AutoMemory;
  /** The background model slot + its serial queue and cumulative spend (T5-R11). */
  utility: UtilitySlot;
  /** The store-maintenance pass (batch 4b); runNow is the WS memory.tidy surface. */
  tidy: TidyPass;
  /** The entry tree's root; media.usage reports its byte footprint (D27). */
  memoryRoot: string;
  /** The bound write op the image-description bridge reuses (#17 decision 6). */
  writeMemory: MemoryWriteOp;
}

export function createMemorySubsystem(deps: MemorySubsystemDeps): MemorySubsystem {
  const { db, logger, timeline } = deps;
  const config = loadMemoryConfig(deps.env);
  // Every background pass takes this model, so moving background work onto a cheaper provider is ONE env change.
  const utility = createUtilitySlot({ mainModel: deps.model, config: loadUtilityConfig(deps.env), logger });
  const engine = buildEngine(deps, config);
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
  });

  // Automatic memory writes (#7): episodic summaries + pre-compaction flush, fired detached after each chat turn.
  // All writes ride the engine's store API (never raw fs) through ONE bound op — the writer chooses the layer
  // (T5 Q11-1), so the binding no longer pins one.
  const writeMemory: MemoryWriteOp = ({ layer, ...rest }) => engine.writeEntry({ ...rest, type: layer });
  const autoMemory = createAutoMemory({
    timeline,
    autoState,
    events,
    episodic: createEpisodicWriter({ model: utility.model, writeMemory }),
    flush: createFlushWriter({ model: utility.model, createTools: (id) => engine.createBackgroundTools(id) }),
    tidy,
    windowStart: deps.windowStart,
    logger: logger.child({ mod: "memory-auto" }),
  });

  // T5-R8: the layer registry's `retention` field finally gets its consumer — boot sweep + 6h, counts-only log.
  startRetentionSweeper({ ops: engine.retention, intentionsDefaultDays: config.intentionsDefaultDays, logger });

  return { engine, autoMemory, utility, tidy, memoryRoot: memoryRootOf(deps.dataDir), writeMemory };
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
