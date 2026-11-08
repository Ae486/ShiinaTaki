/**
 * INPUT:  authority/binding snapshots, connection, setup/lifecycle owners, operation journal and backup inventory
 * OUTPUT: strict composite status with runtime/hold reasons, lifecycle actions, backup evidence and source intervals
 * POS:    read-only Core projection — no network probes; unavailable connections and unknown freshness stay explicit
 */
import {
  MemoryAuthorityStatusSchema, type HindsightBackupStatusSection, type MemoryAuthorityStatus, type MemoryOperation, type MemoryRuntimeUnavailableReason,
} from "@taki/shared";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { readCurrentMemoryAuthorityIdentity, type MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
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
import { activeTemplateHold } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { memoryStatusUnavailableReason, type MemoryRuntimeStatusObservation } from "./memory-status-observer.ts";

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
  /** The backup producer's inventory (a local read); absent leaves the `hindsight.backup` section null. */
  backup?: Pick<HindsightBackupService, "inventory">;
  now?: () => string;
}

type Evidence = Pick<MemoryAuthorityStatus, "replica" | "pending">;

/** Status observes current identity and binding state; producer admission owns complete historical validation. */
export function readMemoryAuthorityStatus(input: MemoryAuthorityStatusInput,
  selection: MemoryAuthoritySelection = readCurrentMemoryAuthorityIdentity(input.db), observation?: MemoryRuntimeStatusObservation): MemoryAuthorityStatus {
  const hindsight = selection.mode === "hindsight";
  const runtime = hindsight && !observation ? input.live() : null;
  let unavailableReason: MemoryRuntimeUnavailableReason | null = observation ? observation.runtime.unavailableReason
    : hindsight && !runtime ? "not_installed" : null;
  if (!observation && selection.mode === "canonical-local" && input.binding) unavailableReason = localRuntimeAvailability(input.binding()).unavailableReason;
  const binding = hindsight ? observation?.hindsightBinding ?? input.hindsightBinding?.() : undefined;
  if (!observation && binding) unavailableReason = hindsightRuntimeAvailability(binding).unavailableReason;
  let evidence: Evidence = observation ? { replica: observation.runtime.replica, pending: observation.runtime.pending } : { replica: null, pending: null };
  let drift: HindsightConnectionDrift | null = observation?.runtime.drift ?? null;
  if (runtime && unavailableReason === null) {
    try {
      drift = runtime.driftReason();
      if (drift === "none") evidence = hindsightEvidence(input.db, runtime); else unavailableReason = drift;
    } catch (error) { unavailableReason = memoryStatusUnavailableReason(error); }
  }
  const setup = input.setup.status();
  const live = hindsight ? liveConnection(input) : null;
  // A runtime a setting keeps unbound reports that setting (the same rule that admits its memory-unavailable Runs).
  const unbound = binding ? hindsightUnboundReason(binding, live) : null;
  if (unbound && unavailableReason !== "authority_invalid") unavailableReason = unbound;
  const held = hindsight && selection.epochId ? activeTemplateHold(input.db, selection.epochId) : null;
  if (held && unavailableReason !== "authority_invalid") unavailableReason = "template_hold";
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
        runtimeDrift: drift, setup, provisioning: provisioning(active), busy: held !== null || active.some(exclusive), unavailableReason,
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

/** A local read of the backup inventory; an unreadable one shows unknown (null) rather than failing the status read. */
function backupStatus(input: MemoryAuthorityStatusInput, at: { epochId: string; now: string }): HindsightBackupStatusSection | null {
  if (!input.backup) return null;
  try {
    const inventory = input.backup.inventory();
    return readHindsightBackupStatus(input.db, { epochId: at.epochId, lastVerified: inventory.lastVerified, inventory, now: at.now });
  } catch { return null; }
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
