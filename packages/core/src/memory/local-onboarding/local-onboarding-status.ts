/**
 * INPUT:  the Local onboarding service reads and the operation owner's newest local-family row
 * OUTPUT: readLocalOnboardingStatus() — one strict MemoryOnboardingStatus with server-derived available actions
 * POS:    core/memory/local-onboarding — read-only projection; missing/unknown state is explicit and no action is inferred from hope
 */
import { MemoryOnboardingStatusSchema, type MemoryOnboardingActions, type MemoryOnboardingRun, type MemoryOnboardingStatus, type MemoryOperation } from "@taki/shared";
import type { PrimaryCustodyStatus } from "../../db/primary-memory-custody-repo.ts";
import type { MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { MemoryOperationService } from "../operations/memory-operation-service.ts";
import { localRuntimeAvailability, type LocalRuntimeAvailability } from "./local-onboarding-reads.ts";
import type { LocalOnboardingService } from "./local-onboarding-service.ts";

export const LOCAL_ONBOARDING_FAMILY = "local-onboarding";

export interface LocalOnboardingStatusInput {
  local: LocalOnboardingService;
  operations: Pick<MemoryOperationService, "latest">;
  now?: () => string;
}

export function readLocalOnboardingStatus(input: LocalOnboardingStatusInput): MemoryOnboardingStatus {
  const { local } = input;
  const view: View = {
    authority: local.authority(), run: local.discover(), operation: input.operations.latest(LOCAL_ONBOARDING_FAMILY) ?? null,
    custody: local.custody(), runtime: localRuntimeAvailability(local.binding()),
  };
  return MemoryOnboardingStatusSchema.parse({
    authority: { mode: view.authority.mode, epochId: view.authority.epochId },
    runtime: view.runtime, run: view.run, operation: view.operation, custody: view.custody,
    actions: deriveActions(view, local), observedAt: (input.now ?? (() => new Date().toISOString()))(),
  });
}

interface View {
  authority: MemoryAuthoritySelection; run: MemoryOnboardingRun | null; operation: MemoryOperation | null;
  custody: PrimaryCustodyStatus; runtime: LocalRuntimeAvailability;
}

/** Actions follow the admission rules of the local kinds; a live family operation disables every command until it settles. */
function deriveActions(view: View, local: LocalOnboardingService): MemoryOnboardingActions {
  const { authority, run, operation, custody, runtime } = view;
  const idle = operation === null || operation.terminalAt !== null;
  const legacy = authority.mode === "legacy-markdown";
  const committed = authority.mode === "canonical-local" && run?.receipt !== null && run?.receipt?.epochId === authority.epochId;
  // A converting run still holds its producer lease; resume/replace would only be refused MIGRATION_BUSY.
  const pending = run !== null && run.status !== "completed" && run.progress.phase !== "converting";
  return {
    preview: legacy && idle,
    prepare: legacy && idle && run === null,
    replace: legacy && idle && pending,
    resume: legacy && idle && pending,
    activate: legacy && idle && run?.status === "ready",
    recoverBinding: idle && committed && !runtime.available,
    reconcileSources: idle && custody.recoverableGroups > 0 && (committed || (legacy && run?.status === "ready")),
    cancelOperationId: operation?.state === "admitted" ? operation.operationId : null,
    retryOperationId: retryable(operation, local),
  };
}

/** Retry only re-materializes a reserved run that never got published; every other outcome routes through preview or resume. */
function retryable(operation: MemoryOperation | null, local: LocalOnboardingService): string | null {
  if (!operation || operation.kind !== "local.onboard.prepare" || operation.terminalAt === null) return null;
  const interrupted = operation.state === "outcome_unknown" || (operation.state === "failed" && operation.errorCode === "MIGRATION_INTERRUPTED");
  if (!interrupted || operation.producer?.kind !== "local" || operation.producer.previewId === null) return null;
  return local.run(operation.producer.runId) === null ? operation.operationId : null;
}
