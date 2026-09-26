/**
 * INPUT:  the authority selection marker, the live Hindsight runtime accessor and connection config, the pure Local and
 *         Hindsight binding snapshots, the B3 setup service, the operation owner and the backup producer's last verified pair
 * OUTPUT: readMemoryAuthorityStatus() — one strict composite MemoryAuthorityStatus with the `hindsight` lifecycle section under
 *         Hindsight authority (open bank.provision Characters, exclusive-family business and the lifecycle revalidate blocker
 *         feed its actions; the backup block carries the last verified pair, its age and the per-Bank missing interval); an
 *         unavailable runtime or an unreadable live connection never fails the read
 * POS:    core/memory/operations — read-only projection, never probes the network; a changed/disabled connection is its own
 *         reason, authority_mismatch only for a real epoch/lineage mismatch; unknown stays unknown (derivedFreshness "unknown")
 */
import {
  MemoryAuthorityStatusSchema, type HindsightBackupStatusSection, type MemoryAuthorityStatus, type MemoryOperation, type MemoryRuntimeUnavailableReason,
} from "@taki/shared";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import { readHindsightBackupStatus } from "../hindsight-backup/hindsight-backup-status.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import type { HindsightLifecycleService } from "../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import type { HindsightConnectionDrift, HindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { hindsightRuntimeAvailability, type HindsightBindingSnapshot } from "../hindsight-runtime-binding.ts";
import { hindsightUnboundReason } from "../hindsight-unbound-run.ts";
import { localRuntimeAvailability } from "../local-onboarding/local-onboarding-reads.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import { readHindsightLifecycleStatus } from "./memory-hindsight-lifecycle-status.ts";
import { EXCLUSIVE_MEMORY_FAMILIES, type MemoryOperationsRuntime } from "./memory-operation-contract.ts";
import { MEMORY_OPERATION_KINDS, memoryOperationHandler } from "./memory-operation-kinds.ts";
import type { MemoryOperationService } from "./memory-operation-service.ts";

export interface MemoryAuthorityStatusInput {
  db: Database;
  live(): MemoryOperationsRuntime | null;
  /** The same pure Local binding snapshot the onboarding status reads; absent means a selected Local runtime is judged available. */
  binding?(): LocalBindingSnapshot;
  /** The pure Hindsight binding snapshot; absent means a selected Hindsight runtime is judged by the live accessor alone. */
  hindsightBinding?(): HindsightBindingSnapshot;
  /** The live Hindsight connection config (state + fingerprint); a local read, never a probe. */
  liveConnection(): HindsightLiveConnection;
  /** The lifecycle owner's revalidate blocker, the one the producer and the automatic trigger apply; absent blocks nothing. */
  lifecycle?: Pick<HindsightLifecycleService, "live" | "revalidateBlocker">;
  setup: HindsightSetupService;
  operations: MemoryOperationService;
  /** The backup producer's last verified pair (a local read); absent leaves the `hindsight.backup` section null. */
  backup?: Pick<HindsightBackupService, "lastVerified">;
  now?: () => string;
}

type Evidence = Pick<MemoryAuthorityStatus, "replica" | "pending">;

export function readMemoryAuthorityStatus(input: MemoryAuthorityStatusInput): MemoryAuthorityStatus {
  const selection = readMemoryAuthoritySelection(input.db);
  const hindsight = selection.mode === "hindsight";
  const runtime = hindsight ? input.live() : null;
  let unavailableReason: MemoryRuntimeUnavailableReason | null = hindsight && !runtime ? "not_installed" : null;
  if (selection.mode === "canonical-local" && input.binding) unavailableReason = localRuntimeAvailability(input.binding()).unavailableReason;
  const binding = hindsight ? input.hindsightBinding?.() : undefined;
  if (binding) unavailableReason = hindsightRuntimeAvailability(binding).unavailableReason;
  let evidence: Evidence = { replica: null, pending: null };
  let drift: HindsightConnectionDrift | null = null;
  if (runtime && unavailableReason === null) {
    try {
      drift = runtime.driftReason();
      if (drift === "none") evidence = hindsightEvidence(input.db, runtime); else unavailableReason = drift;
    } catch (error) { unavailableReason = unavailableReasonOf(error); }
  }
  const setup = input.setup.status();
  const live = hindsight ? liveConnection(input) : null;
  // A runtime a setting keeps unbound reports that setting (the same rule that admits its memory-unavailable Runs).
  const unbound = binding ? hindsightUnboundReason(binding, live) : null;
  if (unbound) unavailableReason = unbound;
  const active = input.operations.list({ includeTerminal: false, limit: 50 });
  const observedAt = (input.now ?? (() => new Date().toISOString()))();
  return MemoryAuthorityStatusSchema.parse({
    authority: { mode: selection.mode, epochId: selection.epochId, providerLineageId: selection.providerLineageId },
    runtime: { providerId: selection.mode === "canonical-local" ? "local" : selection.mode, available: unavailableReason === null, unavailableReason },
    setup,
    ...(unavailableReason === null ? evidence : { replica: null, pending: null }),
    operations: { active, recent: input.operations.recent(20) },
    hindsight: hindsight && selection.epochId
      ? readHindsightLifecycleStatus({ db: input.db, epochId: selection.epochId, live: live ?? { state: "unconfigured", fingerprint: null },
        runtimeDrift: drift, setup, provisioning: provisioning(active), busy: active.some(exclusive), unavailableReason,
        revalidateBlocked: revalidateBlocked(input, selection.epochId), backup: backupStatus(input, { epochId: selection.epochId, now: observedAt }) })
      : null,
    derivedFreshness: "unknown",
    observedAt,
  });
}

/** An unreadable config or Secret Catalog reads as unconfigured; the read itself never fails on it. */
function liveConnection(input: MemoryAuthorityStatusInput): HindsightLiveConnection | null {
  try { return input.liveConnection(); }
  catch { return null; }
}

/** An unreadable blocker input proves nothing is safe to revalidate. */
function revalidateBlocked(input: MemoryAuthorityStatusInput, epochId: string): boolean {
  if (!input.lifecycle) return false;
  try {
    const live = input.lifecycle.live();
    return live.state === "ready" && input.lifecycle.revalidateBlocker(live, epochId) !== null;
  } catch { return true; }
}

function provisioning(active: readonly MemoryOperation[]): string[] {
  return active.flatMap((operation) => operation.request.kind === "bank.provision" ? [operation.request.characterId] : []);
}

/** A local read of the verified-backup record; an unreadable one shows unknown (null) rather than failing the status read. */
function backupStatus(input: MemoryAuthorityStatusInput, at: { epochId: string; now: string }): HindsightBackupStatusSection | null {
  if (!input.backup) return null;
  try { return readHindsightBackupStatus(input.db, { epochId: at.epochId, lastVerified: input.backup.lastVerified(), now: at.now }); }
  catch { return null; }
}

function exclusive(operation: MemoryOperation): boolean {
  const family = memoryOperationHandler(MEMORY_OPERATION_KINDS, operation.kind).family(operation.request);
  return (EXCLUSIVE_MEMORY_FAMILIES as readonly string[]).includes(family);
}

function hindsightEvidence(db: Database, runtime: MemoryOperationsRuntime): Evidence {
  runtime.assertConnection();
  const banks = runtime.banks();
  return {
    replica: runtime.scheduler.status(),
    // The outbox summary and the D77 parent-write count are separate producers; they are reported side by side, never summed.
    pending: banks.map((bank) => ({ bankId: bank.bankId, summary: runtime.pendingSummary(bank.bankId),
      parentWritesPending: countPendingHindsightMemoryWrites(db, { authorityEpochId: runtime.epochId, bankId: bank.bankId }) })),
  };
}

function unavailableReasonOf(error: unknown): MemoryRuntimeUnavailableReason {
  const message = error instanceof Error ? error.message : "";
  if (message === "MEMORY_OPERATION_CANCELLED") return "stopped";
  if (message === "MEMORY_AUTHORITY_MISMATCH") return "authority_mismatch";
  return "connection_unavailable";
}
