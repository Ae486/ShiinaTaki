/**
 * INPUT:  the Core-derived activation actions, setup phase, Bank prerequisites and the card's disposable state
 * OUTPUT: action labels, allow checks, the exact memory.operations.submit request per action and the dispatch through the generic controller
 * POS:    ui/windows/home/pages/operations — presentation routing only; setup.validate/apply are the sole client-derived
 *         allow rules (the status carries no setup flags) and Core revalidates every admission proof
 */
import type { HindsightSetupPhase, MemoryActivationStatus, MemoryOperationRequest } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { openOperation, type HindsightActivationState } from "./hindsight-activation-state.ts";
import type { MemoryOperationsController } from "./memory-operations-controller.ts";

export const ACTIVATION_ACTION_LABEL = {
  validate: "校验连接", apply: "应用配置", activate: "启用 Hindsight", resume: "继续", recoverBinding: "恢复运行时", cancel: "取消",
} as const;
export type ActivationAction = keyof typeof ACTIVATION_ACTION_LABEL;

/** setup.apply needs compatibility evidence (a validated connection); both stay offered after a failed attempt. */
const SETUP_ACTION_PHASES: Record<"validate" | "apply", readonly HindsightSetupPhase[]> = {
  validate: ["ready-to-validate", "compatible", "failed"], apply: ["compatible", "failed"],
};

export function activationActionAllowed(status: MemoryActivationStatus, action: ActivationAction): boolean {
  if (action === "cancel") return status.actions.cancelOperationId !== null;
  if (action === "validate" || action === "apply") {
    if (status.authority.mode !== "canonical-local" || openOperation(status) !== null) return false;
    if (!status.setup.configured) return SETUP_ACTION_PHASES[action].includes(status.setup.phase);
    // A Local Bank created after setup (D86) still lacks its verified B3 row; setup.apply provisions it (grill G8).
    return action === "apply" && status.prerequisites.blocking.some((item) => item.code === "HINDSIGHT_TEMPLATE_NOT_VERIFIED");
  }
  return status.actions[action];
}

export function activationBusyKey(status: MemoryActivationStatus, action: ActivationAction): string {
  return action === "cancel" ? `cancel:${status.actions.cancelOperationId ?? ""}` : `hindsight:${action}`;
}

export function activationRequest(status: MemoryActivationStatus, action: ActivationAction): MemoryOperationRequest | null {
  if (!activationActionAllowed(status, action)) return null;
  const { revision } = status.setup;
  const epochId = status.authority.epochId;
  if (action === "validate") return { kind: "setup.validate", expectedRevision: revision };
  if (action === "apply") return { kind: "setup.apply", expectedRevision: revision, characterId: setupCharacterId(status) };
  if (action === "activate" && epochId) return { kind: "hindsight.activate", source: { mode: "new", setupRevision: revision, expectedEpochId: epochId } };
  if (action === "resume" && status.run) return { kind: "hindsight.activate", source: { mode: "resume", runId: status.run.runId } };
  if (action === "recoverBinding" && epochId) return { kind: "hindsight.activate", source: { mode: "recover", epochId } };
  return null;
}

/** setup.apply provisions the global Bank plus one Character's; the first unverified Character Bank is the pending one. */
function setupCharacterId(status: MemoryActivationStatus): string {
  const characters = status.prerequisites.banks.filter((bank) => bank.scope === "character" && bank.characterId !== null);
  return (characters.find((bank) => !bank.verified) ?? characters[0])?.characterId ?? ACTIVE_CHARACTER_ID;
}

export type ActivationDispatch = Pick<MemoryOperationsController, "submit" | "cancel">;

/** Routes one explicit operator intent; a stale, disconnected or busy frame dispatches nothing (Core is re-read instead). */
export function dispatchActivation(controller: ActivationDispatch, state: HindsightActivationState, action: ActivationAction): Promise<void> {
  const status = state.status;
  if (!status || state.loading || state.error !== null || state.busyKey !== null) return Promise.resolve();
  if (action === "cancel") {
    const operationId = status.actions.cancelOperationId;
    return operationId ? controller.cancel(operationId) : Promise.resolve();
  }
  const request = activationRequest(status, action);
  return request ? controller.submit(request, activationBusyKey(status, action)) : Promise.resolve();
}
