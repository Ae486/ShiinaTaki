/**
 * INPUT:  active Local epoch, timeline, canonical repositories and the process Utility Slot
 * OUTPUT: real Local ingestion/tidy/retention, source witnessing and pre-retirement durability behind one write fence;
 *         start() owns the retention worker; fence/ingestion are exposed for the Hindsight activation drain
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
import type { PrimaryConversationCommit } from "./canonical-ingestion-source.ts";
import { createCanonicalLocalIngestion } from "./canonical-local-ingestion.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { createCanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { fenceCanonicalLocalWriters } from "./canonical-local-writers.ts";
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
  const fence = createCanonicalLocalWriteFence();
  const fenced = fenceCanonicalLocalWriters({ engine, ingestion, tidy, fence,
    onIngestionFailed: (characterId) => input.logger.warn({ code: "MEMORY_INGESTION_FAILED", characterId }, "canonical memory ingestion failed; will retry") });
  // Retention starts only once the binding is published: a draft that fails installation must leave no worker behind.
  let retention: { stop(): void } | undefined;
  const start = (): void => {
    retention ??= startSweeper({ name: "memory-retention", message: "canonical memory retention swept",
      sweep: engine.retentionSweep, logger: input.logger,
      enabled: () => fence.writable() && engine.authority.authorityEpoch().epochId === input.epochId });
  };
  const writeMemory: MemoryWriteOp = ({ layer, ...request }) => fenced.engine.writeEntry({ ...request, type: layer });
  return { engine: fenced.engine, maintenance: fenced.maintenance, memoryFlush: fenced.memoryFlush, tidy: fenced.tidy, writeMemory,
    fence, ingestion, start, stop: () => retention?.stop(), captureRun: fenced.captureRun,
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => {
      try { ingestion.recordPrimaryCommitted(commit); }
      catch { input.logger.warn({ code: "MEMORY_INGESTION_WITNESS_FAILED" }, "primary memory source witness was not committed"); }
    } };
}
