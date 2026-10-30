/**
 * INPUT:  an original layer edit and the currently verified native/artifact policy target
 * OUTPUT: one deterministic policy CAS command, with explicit preflight and independent application proof
 * POS:    core/memory/hindsight — layer edits affect Taki policy only; native factual receipts are preserved separately
 */
import { TakiApplicationMemoryBodySchema, type CanonicalMemoryBank, type TakiApplicationCommand } from "@taki/shared";
import { verifyApplicationCommandClosure } from "../../db/hindsight-application-command-contract.ts";
import type { HindsightMemoryWriteIdentity, HindsightMemoryWriteJob, HindsightMemoryWriteTarget } from "../../db/hindsight-memory-write-contract.ts";
import { canonicalLayerRetention, requireLayerOwnership } from "../canonical-layer-policy.ts";
import { getLayer } from "../layer-registry.ts";
import { prepareHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import type { HindsightMemoryWriteDeps } from "./hindsight-memory-write-context.ts";

interface PlanInput {
  identity: HindsightMemoryWriteIdentity; target: HindsightMemoryWriteTarget; bank: CanonicalMemoryBank;
  at: string; intentionsDefaultDays?: number;
}

export function hindsightMemoryLayerPlan(input: PlanInput) {
  const operation = input.identity.operation;
  if (operation.kind !== "mutation" || operation.request.kind !== "edit" || operation.request.patch.layerId === undefined) return null;
  const layer = getLayer(operation.request.patch.layerId); if (!layer) throw new Error("MEMORY_INVALID_REQUEST");
  requireLayerOwnership(input.bank, layer);
  const previous = input.target.body.policy;
  const fields = { layerId: layer.id, visibility: layer.recallPolicy,
    retention: canonicalLayerRetention({ layer, previous: previous.retention, at: input.at, intentionsDefaultDays: input.intentionsDefaultDays }) };
  if (sameApplicationValue(fields, { layerId: previous.layerId, visibility: previous.visibility, retention: previous.retention })) return null;
  const value = TakiApplicationMemoryBodySchema.parse({ ...input.target.body, policy_basis: "registry",
    policy: { ...previous, ...fields, policyVersion: previous.policyVersion + 1, updatedAt: input.at },
    // An explicit layer edit is evidence of the caller's instruction, not a
    // newly completed model assessment. Older assessment evidence is immutable.
    assessment: { state: "not_required", target: input.target.native, attempts: 0, next_attempt_at: null,
      last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null } });
  const scope = { bankId: input.identity.key.bankId, namespace: input.identity.namespace };
  const body = prepareHindsightApplicationBody({ ...scope, schema: "application-memory.v1", value });
  const command: TakiApplicationCommand = { command: "put_artifact", key: input.target.artifact.key,
    expected_artifact: input.target.artifact, expected_native: input.target.native,
    binding: { kind: "exact_native", native: input.target.native }, body_ref: body.ref,
    actor: { kind: input.identity.actor === "background-policy" ? "background" : "user", actor_ref: input.identity.key.requestId } };
  return { commands: [command], bodies: [body] };
}

export function preflightHindsightMemoryLayer(input: PlanInput): void {
  const plan = hindsightMemoryLayerPlan(input); if (!plan) return;
  const scope = { bankId: input.identity.key.bankId, namespace: input.identity.namespace };
  const commands = prepareHindsightApplicationBody({ ...scope, schema: "application-commands.v1", value: { commands: plan.commands } });
  verifyApplicationCommandClosure({ commands, bodies: plan.bodies }, scope);
}

export function prepareHindsightMemoryLayer(deps: HindsightMemoryWriteDeps, input: {
  job: HindsightMemoryWriteJob; target: HindsightMemoryWriteTarget; bank: CanonicalMemoryBank;
}): HindsightMemoryWriteJob {
  const { job, target, bank } = input; let saved: HindsightMemoryWriteJob | undefined;
  deps.db.transaction(() => {
    const command = deps.writer.prepare({ namespace: job.identity.namespace,
      key: { ...job.identity.key, requestId: `policy:${job.intentHash}` },
      intent: { purpose: "foreground-memory-policy", parent: job.identity, expectedNative: target.native, expectedArtifact: target.artifact },
      create: (at) => {
        const plan = hindsightMemoryLayerPlan({ identity: job.identity, target, bank, at, intentionsDefaultDays: deps.intentionsDefaultDays });
        if (!plan) throw new Error("MEMORY_REVISION_MISMATCH"); return plan;
      } });
    saved = deps.journal.application({ key: job.identity.key, revision: job.revision, command: command.key });
  });
  if (!saved) throw new Error("MEMORY_INTERNAL_ERROR"); return saved;
}
