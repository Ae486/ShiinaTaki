/**
 * INPUT:  frozen original mutation target, actual native proof and the current policy/artifact state
 * OUTPUT: independent policy application or an explicit superseded result without overwriting newer state
 * POS:    core/memory/hindsight — compound native/policy completion; no generic replay or revision fabrication
 */
import type { CanonicalMemoryRecord, PendingMemoryRecord } from "@taki/shared";
import type { HindsightMemoryWriteJob } from "../../db/hindsight-memory-write-contract.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import { readHindsightMemoryWriteTarget, type HindsightMemoryWriteDeps } from "./hindsight-memory-write-context.ts";
import { hindsightMemoryLayerPlan, prepareHindsightMemoryLayer } from "./hindsight-memory-write-policy.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import { hindsightError } from "./hindsight-errors.ts";

interface Work { job: HindsightMemoryWriteJob; child: PendingMemoryRecord | undefined; request(): HindsightCallContext; refresh(): Promise<void> }

export async function completeHindsightMemoryMutation(deps: HindsightMemoryWriteDeps, input: Work): Promise<void> {
  const { job, child } = input; const operation = job.identity.operation;
  if (operation.kind !== "mutation" || job.target === null) throw new Error("MEMORY_INTEGRITY_ERROR");
  if (child && child.phase !== "completed" && child.phase !== "superseded") return;
  input.request();
  if (job.applicationKey) { await applyPolicy(deps, input); return; }
  const target = currentTarget(deps, job);
  const result = child?.nativeResultReceipt?.result; const legacy = child?.nativeReceipt;
  const expectedRevision = child ? result?.mutation?.revision ?? (legacy?.kind === "mutation" ? legacy.revision : null) : job.target.native.object_revision;
  if (child?.phase === "superseded" || !target || target.native.object_revision !== expectedRevision
    || !child && !sameApplicationValue(target.native, job.target.native)) { superseded(deps, job, target?.record ?? null); return; }
  const layer = operation.request.kind === "edit" ? operation.request.patch.layerId : undefined;
  if (layer !== undefined) {
    // A native rebind may advance only the artifact/assessment. A curator or
    // another caller changing the actual policy supersedes this captured edit.
    if (!sameApplicationValue(target.body.policy, job.target.body.policy)) { superseded(deps, job, target.record); return; }
    const binding = deps.replica.bankBinding(job.identity.key.bankId);
    if (!binding?.bank) throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
    const plan = hindsightMemoryLayerPlan({ identity: job.identity, target, bank: binding.bank,
      at: job.preparedAt, intentionsDefaultDays: deps.intentionsDefaultDays });
    if (plan) {
      const prepared = prepareHindsightMemoryLayer(deps, { job, target, bank: binding.bank });
      await applyPolicy(deps, { ...input, job: prepared }); return;
    }
  }
  const outcome = result?.native_outcome ?? (legacy?.kind === "mutation" ? legacy.outcome : "unchanged");
  deps.journal.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "mutation", result: { outcome, record: target.record } } });
}

async function applyPolicy(deps: HindsightMemoryWriteDeps, input: Work): Promise<void> {
  const { job } = input; if (!job.applicationKey) throw new Error("MEMORY_INTEGRITY_ERROR");
  const result = await deps.writer.run({ key: job.applicationKey, context: input.request() }); input.request();
  if (result.status === "pending") throw hindsightError(result.code);
  await input.refresh(); input.request();
  const target = currentTarget(deps, job);
  if (result.status === "refused") {
    const code = result.job.receipt?.refusal?.code;
    if (code !== "native_version_conflict" && code !== "artifact_conflict") throw new Error("MEMORY_INTEGRITY_ERROR");
    superseded(deps, job, target?.record ?? null); return;
  }
  if (!deps.writer.applied(result.job)) return;
  const request = job.identity.operation;
  if (request.kind !== "mutation" || request.request.kind !== "edit") throw new Error("MEMORY_INTEGRITY_ERROR");
  const command = result.job.commands.content;
  if (command.body_schema !== "application-commands.v1") throw new Error("MEMORY_INTEGRITY_ERROR");
  const applied = command.value.commands[0];
  if (!applied || applied.command === "retire_artifact" || !applied.expected_native) throw new Error("MEMORY_INTEGRITY_ERROR");
  const body = result.job.bodies.find((entry) => sameApplicationValue(entry.ref, applied.body_ref))?.content;
  if (body?.body_schema !== "application-memory.v1") throw new Error("MEMORY_INTEGRITY_ERROR");
  // Historical application proves this write happened. It does not turn a
  // newer restriction with the same layer label into this request's result.
  if (!target || !sameApplicationValue(target.native, applied.expected_native) || !sameApplicationValue(target.body.policy, body.value.policy)) {
    superseded(deps, job, target?.record ?? null); return;
  }
  deps.journal.finish({ key: job.identity.key, revision: job.revision,
    terminal: { kind: "mutation", result: { outcome: "applied", record: target.record } } });
}

function currentTarget(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob) {
  const operation = job.identity.operation; if (operation.kind !== "mutation") throw new Error("MEMORY_INTEGRITY_ERROR");
  return readHindsightMemoryWriteTarget(deps, { bankId: job.identity.key.bankId, namespace: job.identity.namespace, memoryId: operation.request.memoryId });
}
function superseded(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob, record: CanonicalMemoryRecord | null): void {
  deps.journal.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "mutation", result: { outcome: "superseded", record } } });
}
