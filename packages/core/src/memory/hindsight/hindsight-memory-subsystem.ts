/**
 * INPUT:  active Hindsight configuration/Bank bindings, SQLite, Timeline and the shared Utility Slot
 * OUTPUT: provider/ingestion/curator/flush plus the existing scheduler, distinct backup/write and transition/work fences,
 *         truthful unavailable captures, primary witnesses, per-Bank sync diagnostics and complete settled shutdown
 * POS:    core/memory/hindsight — selected draft; unresolved source/native activation refuses construction; Core owns Compaction
 */
import { TIMING_CONFIG_KEYS, TIMING_POLICY_DEVELOPMENT_DEFAULTS, TimingDurationMsSchema } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import type { MemoryConfig } from "../../config/memory-config.ts";
import { loadHindsightPolicyConfig } from "../../config/hindsight-policy-config.ts";
import { createHindsightIngestionRepo } from "../../db/hindsight-ingestion-repo.ts";
import { createHindsightPolicyWorkRepo } from "../../db/hindsight-policy-work-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { createMemoryAutoRepo } from "../../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../../db/memory-events-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { TimelineRepo } from "../../db/timeline-repo.ts";
import type { Logger } from "../../logging/logger.ts";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import type { AutoMemoryMaintenance } from "../auto-memory.ts";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { PrimaryConversationCommit } from "../canonical-ingestion-source.ts";
import type { MemoryFlushPort } from "../memory-flush-port.ts";
import type { TidyPass } from "../tidy-pass.ts";
import { buildTidyReport } from "../tidy-report.ts";
import type { UtilitySlot } from "../utility-slot.ts";
import { witnessHindsightPrimaryCommit } from "../hindsight-runtime-binding.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import { hindsightAvailabilityCode } from "./hindsight-memory-provider-context.ts";
import { createHindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";
import { createHindsightRuntimeState, type HindsightRuntimeState } from "./hindsight-runtime-state.ts";
import { createHindsightMemoryRuntime, type HindsightUnavailableRunEvent } from "./hindsight-memory-runtime.ts";
import type { HindsightCaptureSyncEvent } from "./hindsight-capture-sync.ts";
import { createHindsightObservedWriter } from "./hindsight-observed-write.ts";
import { createHindsightIngestion } from "./hindsight-ingestion.ts";
import { createHindsightPolicyCurator, type HindsightPolicyCurator } from "./hindsight-policy-curator.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "./hindsight-replica-scheduler.ts";
import { fenceHindsightWriters } from "./hindsight-writer-fence.ts";
import { sourceTransition } from "../transitions/transition-queued-provider.ts";

interface Input {
  db: Database; epochId: string; config: MemoryConfig; source: ConfigSource; secrets: SecretCatalogService;
  timeline: TimelineRepo; utility: UtilitySlot; logger: Logger; promptDir?: string; now?: () => string; client?: HindsightClient;
  /** Core's automatic lifecycle trigger; it must never fail the capture. */
  onUnavailable?: (event: HindsightUnavailableRunEvent) => void;
}

export function createHindsightMemorySubsystem(input: Input) {
  if (sourceTransition(input.db, input.epochId)) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
  const writeFence = createCanonicalLocalWriteFence();
  const workFence = createCanonicalLocalWriteFence();
  const runtime = createHindsightRuntimeConnection({ ...input, config: input.source });
  const state = createHindsightRuntimeState({ db: input.db, runtime, config: input.config, now: input.now, workFence });
  const foreground = createHindsightMemoryRuntime({ state, promptDir: input.promptDir,
    admissionBudgetMs: () => admissionBudgetMs(input.source, runtime.connection.requestTimeoutMs),
    onUnavailable: (event) => {
      input.logger.warn({ characterId: event.characterId, code: event.reason }, "Hindsight Run admitted without memory");
      input.onUnavailable?.(event);
    },
    onSynced: () => reconnectAfterForegroundSync(scheduler, input.logger), onSync: (event) => logCaptureSync(input.logger, event) });
  const journal = createHindsightIngestionRepo({ db: input.db, pending: state.pending,
    readVerifiedBank: (bankId) => state.replica.bankBinding(bankId)?.bank });
  const ingestion = createHindsightIngestion({ authority: runtime.authority, journal, timeline: input.timeline,
    slot: input.utility, provider: state.provider, resolveBanks: runtime.resolveBanks, config: input.config, now: input.now });
  const work = createHindsightPolicyWorkRepo({ db: input.db, now: input.now, assertActive: (scope) => state.assertActive({
    key: { authorityEpochId: scope.authorityEpochId, bankId: scope.bankId, requestId: "policy-work" }, namespace: scope.namespace }) });
  const curator = createHindsightPolicyCurator({ authority: runtime.authority, replica: state.replica, work, writer: state.writer,
    slot: input.utility, resolveBanks: runtime.resolveBanks, readBlock: state.blocks.read, now: input.now,
    refreshBank: (bankId, context) => state.service.synchronize({ bankId, context }),
    config: () => ({ memory: input.config, policy: loadHindsightPolicyConfig(input.source.env()) }) });
  const scheduleRepo = createHindsightReplicaSchedulerRepo(input.db, input.now);
  const scheduler = createHindsightReplicaScheduler({ repo: scheduleRepo, replica: state.nativeReplica,
    banks: runtime.banks, runner: state.service.runner, ownerId: `hindsight:${input.epochId}`, logger: input.logger });
  state.writes.setRetryScheduler(scheduler);
  const tidy = createTidyAdapter({ state, curator, view: foreground.tidy, logger: input.logger });
  const maintenance: AutoMemoryMaintenance = { run: async (characterId, origin) => {
    runtime.assertConnection();
    // A Character without a routed Bank has nothing to ingest into or curate: no Utility model call, no failure log. Its
    // witnesses stay in the source ledger until the Bank is ready.
    if (!runtime.characterRouted(characterId)) return;
    if (origin === "primary") {
      try { await ingestion.maybeRun({ characterId }); }
      catch { input.logger.warn({ characterId, code: "MEMORY_INGESTION_FAILED" }, "Hindsight source ingestion will retry"); }
    }
    runtime.assertConnection(); await tidy.maybeRun(characterId);
  } };
  const memoryFlush = routedFlushPort(runtime, ingestion);
  const writers = fenceHindsightWriters({ engine: foreground.engine, maintenance, memoryFlush, tidy,
    writeMemory: createHindsightObservedWriter(state),
    captureRun: async (characterId, signal) => {
      if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      // Epoch/lineage mismatch throws here; only a changed or disabled connection degrades the Run.
      const drift = runtime.driftReason(); ingestion.initializeBaseline(characterId);
      return drift === "none" ? foreground.captureRun(characterId, signal) : foreground.unavailableRun(characterId, drift);
    } }, writeFence, () => sourceTransition(input.db, input.epochId) !== undefined);
  return { ...writers, snapshot: foreground.snapshot, state, ingestion, curator, scheduler, writeFence, workFence,
    start: () => { runtime.assertConnection(); scheduler.start(); },
    stop: () => { writeFence.retire(); workFence.retire(); return stopSubsystem({ state, ingestion, curator, scheduler, foreground }); },
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => recordWitness(input, { runtime, ingestion }, commit) };
}

/** Unrouted or held source retirement stays refused, preserving its uncovered Timeline witnesses. */
function routedFlushPort(runtime: ReturnType<typeof createHindsightRuntimeConnection>, ingestion: ReturnType<typeof createHindsightIngestion>): MemoryFlushPort {
  return { prepareRetirement: (request) => {
    try { runtime.assertConnection(); }
    catch { return Promise.resolve({ status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" }); }
    return runtime.characterRouted(request.characterId) ? ingestion.flushPort.prepareRetirement(request)
      : Promise.resolve({ status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" });
  } };
}

/** A foreground success proves the provider is back; a Bank parked in availability backoff catches up now, not at retryDueAt. */
function reconnectAfterForegroundSync(scheduler: HindsightReplicaScheduler, logger: Logger): void {
  try {
    const parked = scheduler.status().some((bank) => bank.automatic && bank.retryDueAt !== null && hindsightAvailabilityCode(bank.errorCode));
    if (parked) scheduler.verifiedReconnect();
  } catch { logger.warn({ code: "HINDSIGHT_REPLICA_SCHEDULE_STALE" }, "verified reconnect after a foreground sync was not requested"); }
}

// The client abandons chat.send at its ack deadline (a live knob); half of it leaves room for the rest of admission.
function admissionBudgetMs(source: ConfigSource, requestTimeoutMs: number): number {
  const ack = TimingDurationMsSchema.safeParse(source.resolve(TIMING_CONFIG_KEYS.chatAckMs)?.value);
  return Math.min(requestTimeoutMs, Math.floor((ack.success ? ack.data : TIMING_POLICY_DEVELOPMENT_DEFAULTS.chatAckMs) / 2));
}

function logCaptureSync(logger: Logger, event: HindsightCaptureSyncEvent): void {
  if (event.outcome === "refused") logger.error(event, "Hindsight Run refused by a memory sync integrity failure");
  else logger.warn(event, "Hindsight Run admission sync incomplete; the Bank catches up in the background");
}

function recordWitness(input: Input, bound: { runtime: ReturnType<typeof createHindsightRuntimeConnection>;
  ingestion: ReturnType<typeof createHindsightIngestion>; }, commit: PrimaryConversationCommit): void {
  try { bound.runtime.assertConnection(); }
  catch {
    // A drifted connection must not lose the source: the marker-routed witness keeps it for ingestion after revalidation.
    if (!witnessHindsightPrimaryCommit({ db: input.db, commit, logger: input.logger, now: input.now })) {
      input.logger.warn({ code: "MEMORY_INGESTION_WITNESS_FAILED" }, "Hindsight primary source witness found no Hindsight marker");
    }
    return;
  }
  try { bound.ingestion.recordPrimaryCommitted(commit); }
  catch { input.logger.warn({ code: "MEMORY_INGESTION_WITNESS_FAILED" }, "Hindsight primary source witness was not committed"); }
}

function createTidyAdapter(input: {
  state: HindsightRuntimeState; curator: HindsightPolicyCurator; view: ReturnType<typeof createHindsightMemoryRuntime>["tidy"]; logger: Logger;
}): TidyPass {
  const { state } = input; const auto = createMemoryAutoRepo(state.db); const events = createMemoryEventsRepo(state.db);
  const runNow: TidyPass["runNow"] = async (characterId) => {
    state.runtime.assertConnection();
    const startedAt = state.now?.() ?? new Date().toISOString();
    // These are actual diagnostics over admitted replica rows, not invented
    // zeros for native consolidation. The narrow curator keeps its own workset.
    const report = buildTidyReport(input.view, { characterId, lastTidyAt: auto.get(characterId).lastTidyAt,
      nowMs: Date.parse(startedAt) }, state.config);
    const result = await input.curator.runNow(characterId); state.runtime.assertConnection();
    if (result.status === "ran") {
      auto.setTidy(characterId, startedAt); events.record({ kind: "tidy", characterId, count: result.edits });
    }
    input.logger.info({ characterId, status: result.status, assessed: result.assessed, blocks: result.blocks,
      pending: result.pending, edits: result.edits, steps: result.steps }, "Hindsight policy review settled");
    return { status: result.status, defects: report.defects, edits: result.edits, steps: result.steps, usage: result.usage };
  };
  return { runNow, maybeRun: async (characterId) => { await runNow(characterId); } };
}

async function stopSubsystem(input: {
  state: HindsightRuntimeState; ingestion: ReturnType<typeof createHindsightIngestion>;
  curator: HindsightPolicyCurator; scheduler: ReturnType<typeof createHindsightReplicaScheduler>;
  foreground: ReturnType<typeof createHindsightMemoryRuntime>;
}): Promise<void> {
  input.state.runtime.stop(); input.state.sync.stop();
  const results = await Promise.allSettled([input.foreground.stop(), input.scheduler.stop(), input.curator.stop(), input.ingestion.stop(),
    input.state.provider.stop(), input.state.writes.stop(), input.state.writer.stop(), input.state.service.stop(), input.state.sync.settle()]);
  if (results.some((result) => result.status === "rejected")) throw new Error("MEMORY_SHUTDOWN_FAILED");
}
