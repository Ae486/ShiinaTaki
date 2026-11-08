/**
 * INPUT:  active authority/namespace guard, original application intent and complete prepared byte bodies
 * OUTPUT: original UUID/time allocation, unfinished binding recovery, CAS dispatch and immutable completion receipts
 * POS:    core/db — D77 command outbox only; remote receipt persistence never confirms local replica application
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TakiApplicationNamespaceSchema, TakiApplicationTimeSchema, type TakiApplicationCommitReceipt } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import {
  HindsightApplicationCommandKeySchema, applicationCommandIntentHash, applicationCommandJsonBytes,
  verifyApplicationCommandClosure, type HindsightApplicationCommandGuard, type HindsightApplicationCommandKey,
  type HindsightApplicationCommandJob, type PrepareHindsightApplicationCommand,
} from "./hindsight-application-command-contract.ts";
import { readApplicationCommand, storeApplicationCommandBody, assertApplicationCommandBodyIdentity,
  applicationCommandKeyParams } from "./hindsight-application-command-storage.ts";
import { hindsightApplicationBytesHash, sameApplicationValue, type HindsightApplicationBody } from "../memory/hindsight/hindsight-application-integrity.ts";
import { applicationCommitRequest } from "../memory/hindsight/hindsight-application-body-transfer.ts";
import { verifyApplicationCommandReceipt } from "../memory/hindsight/hindsight-application-command-receipt.ts";

export interface HindsightApplicationCommandRepoDeps {
  db: Database;
  /** Must synchronously require the captured active epoch, provider lineage and exact verified Bank generation. */
  assertActive(input: HindsightApplicationCommandGuard): void;
  now?: () => string;
  operationId?: () => string;
}
export interface HindsightApplicationCommandCompare { key: HindsightApplicationCommandKey; revision: number }
export interface HindsightApplicationCommandCompletion extends HindsightApplicationCommandCompare {
  receipt: TakiApplicationCommitReceipt; affectedVersionsBody?: HindsightApplicationBody | null;
}
export type HindsightApplicationBindingJobScope = Pick<HindsightApplicationCommandKey, "authorityEpochId" | "bankId">
  & Pick<HindsightApplicationCommandGuard, "namespace">;
export interface HindsightApplicationCommandRepo {
  get(key: HindsightApplicationCommandKey): HindsightApplicationCommandJob | undefined;
  unfinishedBinding(scope: HindsightApplicationBindingJobScope): HindsightApplicationCommandJob | undefined;
  prepare(input: PrepareHindsightApplicationCommand): HindsightApplicationCommandJob;
  markDispatched(input: HindsightApplicationCommandCompare): HindsightApplicationCommandJob;
  recordReceipt(input: HindsightApplicationCommandCompletion): HindsightApplicationCommandJob;
}

export function createHindsightApplicationCommandRepo(deps: HindsightApplicationCommandRepoDeps): HindsightApplicationCommandRepo {
  return {
    get: (key: HindsightApplicationCommandKey) => get(deps, key),
    unfinishedBinding: (scope) => unfinishedBinding(deps, scope),
    prepare: (input: PrepareHindsightApplicationCommand) => prepare(deps, input),
    markDispatched: (input: HindsightApplicationCommandCompare) => markDispatched(deps, input),
    recordReceipt: (input: HindsightApplicationCommandCompletion) => recordReceipt(deps, input),
  };
}

function unfinishedBinding(deps: HindsightApplicationCommandRepoDeps, scope: HindsightApplicationBindingJobScope) {
  const key = HindsightApplicationCommandKeySchema.parse({ authorityEpochId: scope.authorityEpochId, bankId: scope.bankId, requestId: "binding:" });
  const namespace = TakiApplicationNamespaceSchema.parse(scope.namespace);
  assertActive(deps, { key, namespace });
  const row = deps.db.prepare(`SELECT request_id FROM hindsight_application_command_jobs
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND provider_lineage=:lineage AND bank_generation=:generation
      AND application_id=:application AND state IN ('prepared','dispatched') AND request_id GLOB 'binding:*'
    ORDER BY prepared_at,request_id LIMIT 1`).get({ epoch: key.authorityEpochId, bank: key.bankId,
      lineage: namespace.provider_lineage, generation: namespace.bank_generation, application: namespace.application_id });
  return row ? get(deps, HindsightApplicationCommandKeySchema.parse({ ...key, requestId: row.request_id })) : undefined;
}

function get(deps: HindsightApplicationCommandRepoDeps, key: HindsightApplicationCommandKey): HindsightApplicationCommandJob | undefined {
  const job = readApplicationCommand(deps.db, HindsightApplicationCommandKeySchema.parse(key));
  if (job) assertActive(deps, job);
  return job;
}
function requireJob(deps: HindsightApplicationCommandRepoDeps, key: HindsightApplicationCommandKey): HindsightApplicationCommandJob {
  const job = get(deps, key); if (!job) throw new Error("MEMORY_NOT_FOUND"); return job;
}

function prepare(deps: HindsightApplicationCommandRepoDeps, input: PrepareHindsightApplicationCommand): HindsightApplicationCommandJob {
  const guard = { key: HindsightApplicationCommandKeySchema.parse(input.key), namespace: TakiApplicationNamespaceSchema.parse(input.namespace) };
  return atomic(deps, guard, () => {
    const intentHash = applicationCommandIntentHash({ ...guard, intent: input.intent });
    const existing = get(deps, guard.key);
    if (existing) {
      if (!sameApplicationValue(existing.namespace, guard.namespace) || existing.intentHash !== intentHash) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      for (const body of [input.commands, ...input.bodies]) assertApplicationCommandBodyIdentity(deps.db, { bankId: guard.key.bankId, namespace: guard.namespace, body });
      // A retry may have regenerated IDs/times before discovering the outbox. The original intent and wire request win.
      return existing;
    }
    const scope = { bankId: guard.key.bankId, namespace: guard.namespace };
    const bodies = verifyApplicationCommandClosure(input, scope);
    const operationId = z.uuid().parse(deps.operationId?.() ?? randomUUID());
    const preparedAt = timestamp(deps);
    const request = applicationCommitRequest({ ...scope, operationId, commands: input.commands });
    const intentBytes = applicationCommandJsonBytes(input.intent); const requestBytes = applicationCommandJsonBytes(request);
    for (const body of [...bodies, input.commands]) storeApplicationCommandBody(deps.db, { ...scope, body });
    deps.db.prepare(`INSERT INTO hindsight_application_command_jobs
      (authority_epoch_id,bank_id,request_id,provider_lineage,bank_generation,application_id,operation_id,
       intent_bytes,intent_bytes_hash,intent_hash,request_bytes,request_bytes_hash,state,revision,prepared_at,dispatched_at,updated_at,receipt_bytes,receipt_bytes_hash)
      VALUES (:epoch,:bank,:request,:lineage,:generation,'taki',:operation,:intent,:intentBytesHash,:intentHash,
       :wire,:wireHash,'prepared',1,:at,NULL,:at,NULL,NULL)`)
      .run({ ...applicationCommandKeyParams(guard.key), lineage: guard.namespace.provider_lineage, generation: guard.namespace.bank_generation,
        operation: operationId, intent: intentBytes, intentBytesHash: hindsightApplicationBytesHash(intentBytes), intentHash,
        wire: requestBytes, wireHash: hindsightApplicationBytesHash(requestBytes), at: preparedAt });
    return requireJob(deps, guard.key);
  });
}

function markDispatched(deps: HindsightApplicationCommandRepoDeps, input: HindsightApplicationCommandCompare): HindsightApplicationCommandJob {
  const captured = requireJob(deps, input.key);
  return atomic(deps, captured, () => {
    const job = requireJob(deps, input.key); compare(job, input.revision);
    if (job.state === "dispatched") return job;
    if (job.state !== "prepared") throw new Error("MEMORY_REVISION_MISMATCH");
    const changed = deps.db.prepare(`UPDATE hindsight_application_command_jobs SET state='dispatched',revision=revision+1,dispatched_at=:at,updated_at=:at
      WHERE authority_epoch_id=:epoch AND bank_id=:bank AND request_id=:request AND revision=:revision AND state='prepared'`)
      .run({ ...applicationCommandKeyParams(job.key), revision: job.revision, at: timestamp(deps) });
    if (changed.changes !== 1) throw new Error("MEMORY_REVISION_MISMATCH");
    return requireJob(deps, job.key);
  });
}

function recordReceipt(deps: HindsightApplicationCommandRepoDeps, input: HindsightApplicationCommandCompletion): HindsightApplicationCommandJob {
  const captured = requireJob(deps, input.key);
  return atomic(deps, captured, () => {
    const job = requireJob(deps, input.key);
    const receipt = verifyApplicationCommandReceipt({ ...input, job });
    if (job.receipt) {
      if (!sameApplicationValue(job.receipt, receipt)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      return job;
    }
    compare(job, input.revision);
    if (job.state !== "dispatched") throw new Error("MEMORY_REVISION_MISMATCH");
    if (input.affectedVersionsBody) storeApplicationCommandBody(deps.db, {
      bankId: job.key.bankId, namespace: job.namespace, body: input.affectedVersionsBody,
    });
    const bytes = applicationCommandJsonBytes(receipt);
    const changed = deps.db.prepare(`UPDATE hindsight_application_command_jobs SET state=:state,revision=revision+1,
      receipt_bytes=:receipt,receipt_bytes_hash=:hash,updated_at=:at
      WHERE authority_epoch_id=:epoch AND bank_id=:bank AND request_id=:request AND revision=:revision AND state='dispatched'`)
      .run({ ...applicationCommandKeyParams(job.key), revision: job.revision, state: receipt.state,
        receipt: bytes, hash: hindsightApplicationBytesHash(bytes), at: timestamp(deps) });
    if (changed.changes !== 1) throw new Error("MEMORY_REVISION_MISMATCH");
    return requireJob(deps, job.key);
  });
}

function compare(job: HindsightApplicationCommandJob, revision: number): void {
  if (!z.int().positive().safeParse(revision).success || job.revision !== revision) throw new Error("MEMORY_REVISION_MISMATCH");
}
function timestamp(deps: HindsightApplicationCommandRepoDeps): string {
  return TakiApplicationTimeSchema.parse(deps.now?.() ?? new Date().toISOString());
}
function assertActive(deps: HindsightApplicationCommandRepoDeps, input: HindsightApplicationCommandGuard): void {
  if (Object.prototype.toString.call(deps.assertActive) === "[object AsyncFunction]") throw new Error("MEMORY_INVALID_REQUEST");
  const result: unknown = deps.assertActive({ key: { ...input.key }, namespace: { ...input.namespace } });
  if (result !== null && typeof result === "object" && "then" in result) throw new Error("MEMORY_INVALID_REQUEST");
}
function atomic<T>(deps: HindsightApplicationCommandRepoDeps, guard: HindsightApplicationCommandGuard, action: () => T): T {
  let result: { value: T } | undefined;
  deps.db.transaction(() => { assertActive(deps, guard); result = { value: action() }; assertActive(deps, guard); });
  if (!result) throw new Error("MEMORY_INTERNAL_ERROR");
  return result.value;
}
