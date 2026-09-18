/**
 * INPUT:  an immutable original D77 command, historical receipt and affected-version byte body
 * OUTPUT: exact namespace/request/result proof and complete per-command artifact revision validation
 * POS:    core/memory/hindsight — remote completion proof only; local replica publication remains a separate fence
 */
import { TakiApplicationCommitReceiptSchema, TakiApplicationCommitStatusSchema,
  type TakiApplicationCommitReceipt, type TakiApplicationCommitStatus } from "@taki/shared";
import type { HindsightApplicationCommandJob } from "../../db/hindsight-application-command-contract.ts";
import { applicationCommandList } from "../../db/hindsight-application-command-contract.ts";
import { hindsightApplicationHash, requireApplicationScope, sameApplicationValue, verifyHindsightApplicationBody,
  withoutApplicationHash, type HindsightApplicationBody } from "./hindsight-application-integrity.ts";

type OriginalCommand = Pick<HindsightApplicationCommandJob, "key" | "namespace" | "request" | "commands">;

export function applicationCommandStatusReceipt(input: {
  job: OriginalCommand; status: TakiApplicationCommitStatus;
}): TakiApplicationCommitReceipt | null {
  const { job } = input; const status = TakiApplicationCommitStatusSchema.parse(input.status);
  requireApplicationScope(status, { bankId: job.key.bankId, namespace: job.namespace });
  if (status.operation_id !== job.request.operation_id) invalid();
  if (status.state === "absent") { if (status.receipt !== null) invalid(); return null; }
  if (status.receipt === null || status.receipt.state !== status.state) invalid();
  return verifyApplicationCommandReceiptHeader({ job, receipt: status.receipt });
}

export function verifyApplicationCommandReceiptHeader(input: {
  job: OriginalCommand; receipt: TakiApplicationCommitReceipt;
}): TakiApplicationCommitReceipt {
  const { job } = input; const receipt = TakiApplicationCommitReceiptSchema.parse(input.receipt);
  const scope = { bankId: job.key.bankId, namespace: job.namespace };
  requireApplicationScope(receipt, scope);
  if (receipt.operation_id !== job.request.operation_id || receipt.request_hash !== job.request.request_hash
    || hindsightApplicationHash({ ...scope, domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") }) !== receipt.result_hash) invalid();
  if (receipt.state === "refused") {
    if (receipt.refusal === null || receipt.checkpoint !== null || receipt.affected_versions_ref !== null) invalid();
  } else if (receipt.refusal !== null || receipt.checkpoint === null || receipt.checkpoint.state_cursor === 0
    || receipt.affected_versions_ref?.body_schema !== "application-affected-versions.v1") invalid();
  return receipt;
}

export function verifyApplicationCommandReceipt(input: {
  job: OriginalCommand; receipt: TakiApplicationCommitReceipt; affectedVersionsBody?: HindsightApplicationBody | null;
}): TakiApplicationCommitReceipt {
  const receipt = verifyApplicationCommandReceiptHeader(input);
  if (receipt.state === "refused") { if (input.affectedVersionsBody != null) invalid(); return receipt; }
  const body = input.affectedVersionsBody;
  if (!body || !sameApplicationValue(body.ref, receipt.affected_versions_ref)) invalid();
  verifyHindsightApplicationBody(body, { bankId: input.job.key.bankId, namespace: input.job.namespace });
  if (body.content.body_schema !== "application-affected-versions.v1") invalid();
  const commands = applicationCommandList(input.job.commands);
  const checkpoint = receipt.checkpoint;
  if (checkpoint === null) invalid();
  const affected = new Map(body.content.value.artifacts.map((version) => [artifactKey(version.key), version]));
  if (affected.size !== commands.length || body.content.value.artifacts.length !== commands.length) invalid();
  for (const command of commands) {
    const version = affected.get(artifactKey(command.key));
    if (!version || version.revision !== (command.expected_artifact?.revision ?? 0) + 1
      || command.expected_native?.native_cursor != null && checkpoint.native_cursor < command.expected_native.native_cursor) invalid();
  }
  return receipt;
}

function artifactKey(key: { artifact_kind: string; artifact_id: string }): string { return JSON.stringify([key.artifact_kind, key.artifact_id]); }
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR"); }
