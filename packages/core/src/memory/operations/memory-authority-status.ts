/**
 * INPUT:  the authority selection marker, the live Hindsight runtime accessor, the pure Local binding snapshot, the B3 setup
 *         service and the operation owner
 * OUTPUT: readMemoryAuthorityStatus() — one strict composite MemoryAuthorityStatus; an unavailable runtime never fails the read
 * POS:    core/memory/operations — read-only projection; unknown stays unknown (derivedFreshness is always "unknown")
 */
import { MemoryAuthorityStatusSchema, type MemoryAuthorityStatus, type MemoryRuntimeUnavailableReason } from "@taki/shared";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import { localRuntimeAvailability } from "../local-onboarding/local-onboarding-reads.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import type { MemoryOperationsRuntime } from "./memory-operation-contract.ts";
import type { MemoryOperationService } from "./memory-operation-service.ts";

export interface MemoryAuthorityStatusInput {
  db: Database;
  live(): MemoryOperationsRuntime | null;
  /** The same pure Local binding snapshot the onboarding status reads; absent means a selected Local runtime is judged available. */
  binding?(): LocalBindingSnapshot;
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
  let evidence: Evidence = { replica: null, pending: null };
  if (runtime) {
    try { evidence = hindsightEvidence(input.db, runtime); }
    catch (error) { unavailableReason = unavailableReasonOf(error); }
  }
  return MemoryAuthorityStatusSchema.parse({
    authority: { mode: selection.mode, epochId: selection.epochId, providerLineageId: selection.providerLineageId },
    runtime: { providerId: selection.mode === "canonical-local" ? "local" : selection.mode, available: unavailableReason === null, unavailableReason },
    setup: input.setup.status(),
    ...(unavailableReason === null ? evidence : { replica: null, pending: null }),
    operations: { active: input.operations.list({ includeTerminal: false, limit: 50 }), recent: input.operations.recent(20) },
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
