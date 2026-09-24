/**
 * INPUT:  the authority selection marker, the live Hindsight runtime accessor and connection config, the pure Local and
 *         Hindsight binding snapshots, the B3 setup service and the operation owner
 * OUTPUT: readMemoryAuthorityStatus() — one strict composite MemoryAuthorityStatus with the `hindsight` lifecycle section under
 *         Hindsight authority; an unavailable runtime never fails the read
 * POS:    core/memory/operations — read-only projection, never probes the network; a changed/disabled connection is its own
 *         reason, authority_mismatch only for a real epoch/lineage mismatch; unknown stays unknown (derivedFreshness "unknown")
 */
import { MemoryAuthorityStatusSchema, type MemoryAuthorityStatus, type MemoryRuntimeUnavailableReason } from "@taki/shared";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import type { HindsightConnectionDrift, HindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { hindsightRuntimeAvailability, type HindsightBindingSnapshot } from "../hindsight-runtime-binding.ts";
import { hindsightUnboundReason } from "../hindsight-unbound-run.ts";
import { localRuntimeAvailability } from "../local-onboarding/local-onboarding-reads.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import { readHindsightLifecycleStatus } from "./memory-hindsight-lifecycle-status.ts";
import type { MemoryOperationsRuntime } from "./memory-operation-contract.ts";
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
  setup: HindsightSetupService;
  operations: MemoryOperationService;
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
  const live = hindsight ? input.liveConnection() : null;
  // A runtime a setting keeps unbound reports that setting (the same rule that admits its memory-unavailable Runs).
  const unbound = binding ? hindsightUnboundReason(binding, live) : null;
  if (unbound) unavailableReason = unbound;
  return MemoryAuthorityStatusSchema.parse({
    authority: { mode: selection.mode, epochId: selection.epochId, providerLineageId: selection.providerLineageId },
    runtime: { providerId: selection.mode === "canonical-local" ? "local" : selection.mode, available: unavailableReason === null, unavailableReason },
    setup,
    ...(unavailableReason === null ? evidence : { replica: null, pending: null }),
    operations: { active: input.operations.list({ includeTerminal: false, limit: 50 }), recent: input.operations.recent(20) },
    hindsight: live && selection.epochId
      ? readHindsightLifecycleStatus({ db: input.db, epochId: selection.epochId, live, runtimeDrift: drift, setup, provisioning: [] })
      : null,
    derivedFreshness: "unknown",
    observedAt: (input.now ?? (() => new Date().toISOString()))(),
  });
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
