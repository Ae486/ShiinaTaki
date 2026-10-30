/**
 * INPUT:  SQLite rows and fully validated immutable D77 command/body values
 * OUTPUT: complete byte-preserving job reads and conflict-checked body inserts
 * POS:    core/db — private outbox storage; no JSON1 recursion, remote I/O or confirmed replica mutations
 */
import { TakiApplicationBodyRefSchema, TakiApplicationCommitRequestSchema, TakiApplicationCommitReceiptSchema } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import {
  HindsightApplicationCommandMetaSchema, applicationCommandIntentHash, applicationCommandJsonBytes,
  applicationCommandJsonValue, applicationCommandList, verifyApplicationCommandClosure,
  type HindsightApplicationCommandJob, type HindsightApplicationCommandKey,
} from "./hindsight-application-command-contract.ts";
import {
  decodeHindsightApplicationBody, hindsightApplicationBytesHash, sameApplicationValue,
  type HindsightApplicationBody, type HindsightApplicationScope,
} from "../memory/hindsight/hindsight-application-integrity.ts";
import { applicationCommitRequest } from "../memory/hindsight/hindsight-application-body-transfer.ts";
import { verifyApplicationCommandReceipt } from "../memory/hindsight/hindsight-application-command-receipt.ts";

export function applicationCommandKeyParams(key: HindsightApplicationCommandKey) {
  return { epoch: key.authorityEpochId, bank: key.bankId, request: key.requestId };
}
export function readApplicationCommand(db: Database, key: HindsightApplicationCommandKey): HindsightApplicationCommandJob | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_command_jobs
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND request_id=:request`).get(applicationCommandKeyParams(key));
  if (!row) return;
  try { return decodeJob(db, row); }
  catch { throw new Error("MEMORY_INTEGRITY_ERROR"); }
}

function decodeJob(db: Database, row: SqlRow): HindsightApplicationCommandJob {
  const meta = HindsightApplicationCommandMetaSchema.parse({
    key: { authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, requestId: row.request_id },
    namespace: { provider_lineage: row.provider_lineage, bank_generation: row.bank_generation, application_id: row.application_id },
    operationId: row.operation_id, intentHash: row.intent_hash, state: row.state, revision: row.revision,
    preparedAt: row.prepared_at, dispatchedAt: row.dispatched_at, updatedAt: row.updated_at,
  });
  const scope = { bankId: meta.key.bankId, namespace: meta.namespace };
  const intent = readJson(row.intent_bytes, row.intent_bytes_hash);
  if (applicationCommandIntentHash({ ...meta, intent }) !== meta.intentHash) invalid();
  const request = TakiApplicationCommitRequestSchema.parse(readJson(row.request_bytes, row.request_bytes_hash));
  const commands = requireApplicationCommandBody(db, { ...scope, bodyId: request.commands_ref.body_id });
  if (!sameApplicationValue(request, applicationCommitRequest({ ...scope, operationId: meta.operationId, commands }))) invalid();
  const bodies = commandBodies(db, { ...scope, commands });
  verifyApplicationCommandClosure({ commands, bodies }, scope);
  const receipt = row.receipt_bytes === null ? null : TakiApplicationCommitReceiptSchema.parse(readJson(row.receipt_bytes, row.receipt_bytes_hash));
  const affectedVersionsBody = receipt?.affected_versions_ref
    ? requireApplicationCommandBody(db, { ...scope, bodyId: receipt.affected_versions_ref.body_id }) : null;
  const job: HindsightApplicationCommandJob = { ...meta, intent, request, commands, bodies, receipt, affectedVersionsBody };
  if ((meta.state === "prepared") !== (meta.dispatchedAt === null)
    || (meta.state === "completed" || meta.state === "refused") !== (receipt !== null)
    || (receipt === null) !== (row.receipt_bytes_hash === null)) invalid();
  if (receipt) {
    if (receipt.state !== meta.state) invalid();
    verifyApplicationCommandReceipt({ job, receipt, affectedVersionsBody });
  }
  return job;
}

function commandBodies(db: Database, input: HindsightApplicationScope & { commands: HindsightApplicationBody }): HindsightApplicationBody[] {
  const ids = new Set(applicationCommandList(input.commands).flatMap((command) => command.command === "retire_artifact" ? [] : [command.body_ref.body_id]));
  return [...ids].map((bodyId) => requireApplicationCommandBody(db, { ...input, bodyId }));
}

export function readApplicationCommandBody(db: Database, input: HindsightApplicationScope & { bodyId: string }): HindsightApplicationBody | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_command_bodies
    WHERE provider_lineage=:lineage AND bank_id=:bank AND bank_generation=:generation AND body_id=:body`)
    .get(bodyParams(input));
  if (!row) return;
  const ref = TakiApplicationBodyRefSchema.parse(readJson(row.ref_bytes, row.ref_bytes_hash));
  if (ref.body_id !== input.bodyId || !(row.body_bytes instanceof Uint8Array)) invalid();
  return decodeHindsightApplicationBody({ ...input, ref, bytes: row.body_bytes });
}
function requireApplicationCommandBody(db: Database, input: HindsightApplicationScope & { bodyId: string }): HindsightApplicationBody {
  const body = readApplicationCommandBody(db, input); if (!body) invalid(); return body;
}

export function storeApplicationCommandBody(db: Database, input: HindsightApplicationScope & { body: HindsightApplicationBody }): void {
  if (assertApplicationCommandBodyIdentity(db, input)) return;
  const refBytes = applicationCommandJsonBytes(input.body.ref);
  db.prepare(`INSERT INTO hindsight_application_command_bodies
    (provider_lineage,bank_id,bank_generation,body_id,ref_bytes,ref_bytes_hash,body_bytes)
    VALUES (:lineage,:bank,:generation,:body,:ref,:refHash,:bytes)`)
    .run({ ...bodyParams({ ...input, bodyId: input.body.ref.body_id }), ref: refBytes,
      refHash: hindsightApplicationBytesHash(refBytes), bytes: input.body.bytes });
}

/** Existing immutable body IDs can never be repurposed, including on a same-intent preparation retry. */
export function assertApplicationCommandBodyIdentity(db: Database, input: HindsightApplicationScope & { body: HindsightApplicationBody }): boolean {
  const prior = readApplicationCommandBody(db, { ...input, bodyId: input.body.ref.body_id });
  if (!prior) return false;
  if (!sameApplicationValue(prior.ref, input.body.ref) || !Buffer.from(prior.bytes).equals(input.body.bytes)) {
    throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  }
  return true;
}
function bodyParams(input: HindsightApplicationScope & { bodyId: string }) {
  return { lineage: input.namespace.provider_lineage, bank: input.bankId, generation: input.namespace.bank_generation, body: input.bodyId };
}
function readJson(bytes: unknown, hash: unknown) {
  if (!(bytes instanceof Uint8Array) || hindsightApplicationBytesHash(bytes) !== hash) invalid();
  return applicationCommandJsonValue(bytes);
}
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR"); }
