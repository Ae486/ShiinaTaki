/**
 * INPUT:  active Local epoch, timeline, canonical repositories and the process Utility Slot
 * OUTPUT: real Local ingestion/tidy/retention, source witnessing and pre-retirement durability; start() owns the retention worker
 * POS:    core/memory — provider-specific background composition built as a draft and started by the runtime binding; Compaction remains Core-owned
 */
import type { MemoryConfig } from "../config/memory-config.ts";
import { createCanonicalIngestionRepo } from "../db/canonical-ingestion-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { Logger } from "../logging/logger.ts";
import { startSweeper } from "../scheduler/sweep-runner.ts";
import type { AutoMemoryMaintenance } from "./auto-memory.ts";
import type { PrimaryConversationCommit } from "./canonical-ingestion-source.ts";
import { createCanonicalLocalIngestion } from "./canonical-local-ingestion.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import { createTidyPass } from "./tidy-pass.ts";
import type { UtilitySlot } from "./utility-slot.ts";

export function createCanonicalLocalSubsystem(input: {
  db: Database; epochId: string; promptDir: string; timeline: TimelineRepo;
  utility: UtilitySlot; config: MemoryConfig; logger: Logger;
}) {
  const engine = createCanonicalLocalRuntime(input);
  const autoState = createMemoryAutoRepo(input.db);
  const events = createMemoryEventsRepo(input.db);
  const journal = createCanonicalIngestionRepo({ db: input.db, maintenance: engine.maintenanceStore });
  const ingestion = createCanonicalLocalIngestion({ provider: engine.provider, authority: engine.authority,
    maintenance: engine.maintenanceStore, journal, timeline: input.timeline, autoState, slot: input.utility, events, config: input.config });
  const tidy = createTidyPass({ view: engine.tidy, autoState, events, slot: input.utility,
    config: input.config, logger: input.logger.child({ mod: "memory-tidy" }) });
  for (const bank of engine.authority.listBanks(input.epochId)) {
    if (bank.scope.kind === "character") ingestion.initializeBaseline(bank.scope.characterId);
  }
  // Retention starts only once the binding is published: a draft that fails installation must leave no worker behind.
  let retention: { stop(): void } | undefined;
  const start = (): void => {
    retention ??= startSweeper({ name: "memory-retention", message: "canonical memory retention swept",
      sweep: engine.retentionSweep, logger: input.logger,
      enabled: () => engine.authority.authorityEpoch().epochId === input.epochId });
  };
  const maintenance: AutoMemoryMaintenance = { run: async (characterId, origin) => {
    if (origin === "primary") {
      try { await ingestion.maybeRun({ characterId }); }
      catch { input.logger.warn({ code: "MEMORY_INGESTION_FAILED", characterId }, "canonical memory ingestion failed; will retry"); }
    }
    await tidy.maybeRun(characterId);
  } };
  const writeMemory: MemoryWriteOp = ({ layer, ...request }) => engine.writeEntry({ ...request, type: layer });
  return { engine, maintenance, memoryFlush: ingestion.flushPort, tidy, writeMemory, start, stop: () => retention?.stop(),
    captureRun: (characterId: string) => {
      engine.banks(characterId);
      ingestion.initializeBaseline(characterId);
      return engine.captureRun(characterId);
    },
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => {
      try { ingestion.recordPrimaryCommitted(commit); }
      catch { input.logger.warn({ code: "MEMORY_INGESTION_WITNESS_FAILED" }, "primary memory source witness was not committed"); }
    } };
}
