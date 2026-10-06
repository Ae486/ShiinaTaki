/**
 * INPUT: local authority/configuration, the sole operation ledger and factual transition status.
 * OUTPUT: bounded active/recent transition history with Core-derived actions under Local or unavailable runtimes.
 * POS: core/memory/transitions — observation only; opening a preview is distinct from permission to commit.
 */
import { MemoryTransitionKindSchema, MemoryTransitionOverviewSchema, MemoryTransitionEmergencyDisclosureSchema,
  type MemoryTransitionActionReason, type MemoryTransitionRead } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { emergencyCanQuarantineOperation } from "../../db/memory-transition-emergency-quarantine.ts";
import { EXCLUSIVE_MEMORY_FAMILIES } from "../operations/memory-operation-contract.ts";
import { createTransitionOperationStorage } from "../operations/memory-operation-transition-storage.ts";
import { assertEmergencyConfiguration, assertTransitionConfiguration, transitionConfiguration } from "./transition-current-identity.ts";
import { selectedForeignBranch, transitionRecoveryReason, transitionOperatorSelection, pendingSelectedTransitions } from "./transition-operator-actions.ts";
import { readEmergencyIncident } from "../../db/memory-transition-emergency-repo.ts";
import { readTransitionPreview } from "../../db/memory-transition-preview-repo.ts";

interface Input { db: Database; now(): string; fingerprint(): string | null; status(id: string): MemoryTransitionRead;
  ready(epochId: string, provider: "local" | "hindsight"): boolean }
const action = (reason: MemoryTransitionActionReason | null) => ({ allowed: reason === null, reason });

export function readTransitionOverview(input: Input) {
  const { db } = input; const selected = transitionOperatorSelection(db);
  const provider = selected.mode === "hindsight" ? "hindsight" : selected.mode === "canonical-local" ? "local" : null;
  const repo = createMemoryOperationRepo(db); const storage = createTransitionOperationStorage(db);
  const exclusive = EXCLUSIVE_MEMORY_FAMILIES.flatMap((family) => { const row = repo.activeInFamily(family); return row ? [row] : []; });
  const foreign = selectedForeignBranch(db);
  const pending = pendingSelectedTransitions(db, selected.epochId);
  const configuration = () => { try { transitionConfiguration(db, input.fingerprint()); return true; } catch { return false; } };
  // An eligible action only opens a fresh preview. Expensive complete corpus/remote capability proofs stay there.
  const actions = MemoryTransitionKindSchema.options.map((kind) => {
    let reason: MemoryTransitionActionReason | null = null;
    const source = kind === "transition.reenter-hindsight" ? "local" : "hindsight";
    if (provider !== source || !selected.epochId) reason = "wrong-provider";
    else if (kind === "transition.emergency-local") {
      const epochId = selected.epochId;
      if (pending.includes("transition.emergency-local") || exclusive.some((row) => !emergencyCanQuarantineOperation(db, row, epochId))) reason = "busy";
    } else if (foreign) reason = "foreign-branch";
    else if (exclusive.length || pending.length) reason = "busy";
    else if (!configuration()) reason = "configuration";
    else if (source === "local" && !db.prepare(`SELECT 1 FROM memory_transition_baselines b
      JOIN memory_transition_candidate_reservations r USING(transition_id) WHERE r.target_epoch_id=:epoch`).get({ epoch: selected.epochId })) reason = "baseline";
    else if (!input.ready(selected.epochId, source)) reason = "unavailable";
    return { kind, ...action(reason) };
  });
  const ids = db.prepare(`SELECT operation_id FROM memory_operations WHERE family='memory-transition'
    ORDER BY (terminal_at IS NULL) DESC,created_at DESC,rowid DESC LIMIT 51`).all();
  const entries = ids.slice(0, 50).map((row) => {
    const operation = repo.get(String(row.operation_id));
    if (operation?.producer?.kind !== "transition") throw new Error("MEMORY_TRANSITION_UNAVAILABLE");
    const status = input.status(operation.producer.transitionId);
    let reason = transitionRecoveryReason(db, status.transition.intent, input.now());
    if (!reason && exclusive.length) reason = "busy";
    if (!reason) {
      try {
        const expected = status.transition.intent.request.expected;
        if (operation.kind === "transition.emergency-local") assertEmergencyConfiguration(db, expected);
        else assertTransitionConfiguration(db, expected, input.fingerprint());
      } catch { reason = "configuration"; }
    }
    return { operation, status, recovery: action(reason), emergency: emergencyDisclosure(db, status),
      currentAuthority: selected.epochId === (status.transition.receipt?.newEpochId ?? status.transition.intent.request.expected.predecessorEpochId),
      cancel: action(operation.state === "admitted" && storage.canCancel(operation) ? null : operation.terminalAt ? "settled" : "busy") };
  });
  return MemoryTransitionOverviewSchema.parse({ provider, epochId: selected.epochId, actions, entries, hasOlder: ids.length > 50 });
}

function emergencyDisclosure(db: Database, status: MemoryTransitionRead) {
  const intent = status.transition.intent;
  if (intent.request.kind !== "transition.emergency-local") return null;
  const incident = readEmergencyIncident(db, intent.transitionId);
  const preview = readTransitionPreview(db, intent.request.previewId);
  if (preview.version !== 2) throw new Error("MEMORY_TRANSITION_UNAVAILABLE");
  return MemoryTransitionEmergencyDisclosureSchema.parse({
    banks: (incident?.transition?.banks ?? preview.banks).map((bank) => MemoryTransitionEmergencyDisclosureSchema.shape.banks.element.parse({
      bankId: bank.bankId, scope: bank.scope, nativeGeneration: bank.nativeGeneration, replicaCursor: bank.replicaCursor,
      applicationNativeCursor: bank.applicationNativeCursor, applicationStateCursor: bank.applicationStateCursor,
      backupNativeCursor: bank.backupNativeCursor, backupApplicationNativeCursor: bank.backupApplicationNativeCursor,
      backupApplicationStateCursor: bank.backupApplicationStateCursor, pendingCount: bank.pendingCount, checkpointHash: bank.checkpointHash,
      evidence: bank.evidence, remoteHead: bank.remoteHead, remoteLoss: bank.remoteLoss,
    })),
    backupAgeSeconds: incident ? incident.backupAgeSeconds : preview.backupAgeSeconds,
    lastVerifiedBackupId: incident ? incident.lastVerifiedBackupId : preview.lastVerifiedBackupId,
  });
}
