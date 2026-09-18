/**
 * INPUT:  SQLite BLOB rows and validated policy-work snapshots/results
 * OUTPUT: complete hash-checked journal reads and version-CAS state updates
 * POS:    core/db — private curator storage; original target and command identity are never replaced
 */
import type { Database, SqlRow } from "./sqlite.ts";
import { applicationCommandJsonBytes, applicationCommandJsonValue } from "./hindsight-application-command-contract.ts";
import { hindsightApplicationBytesHash, sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";
import { HindsightPolicyWorkRecordSchema, hindsightPolicyWorkIdentity, validateHindsightPolicyWorkTarget,
  validateHindsightPolicyWorkResult, type HindsightPolicyWorkKey, type HindsightPolicyWorkRecord,
  type HindsightPolicyWorkScope } from "./hindsight-policy-work-contract.ts";

export function policyWorkParams(scope: HindsightPolicyWorkScope) {
  return { epoch: scope.authorityEpochId, bank: scope.bankId,
    lineage: scope.namespace.provider_lineage, generation: scope.namespace.bank_generation };
}
export function readPolicyWork(db: Database, key: HindsightPolicyWorkKey): HindsightPolicyWorkRecord | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_policy_work WHERE authority_epoch_id=:epoch AND bank_id=:bank
    AND provider_lineage=:lineage AND bank_generation=:generation AND work_id=:id`).get({ ...policyWorkParams(key), id: key.workId });
  return row ? parsePolicyWork(row) : undefined;
}
export function listPolicyWork(db: Database, input: HindsightPolicyWorkScope & { at: string; limit: number }): HindsightPolicyWorkRecord[] {
  return db.prepare(`SELECT * FROM hindsight_policy_work WHERE authority_epoch_id=:epoch AND bank_id=:bank
    AND provider_lineage=:lineage AND bank_generation=:generation AND state IN ('ready','claimed','saved')
    AND (next_attempt_at IS NULL OR julianday(next_attempt_at)<=julianday(:at))
    AND (claim_until IS NULL OR julianday(claim_until)<=julianday(:at)) ORDER BY created_at,work_id LIMIT :limit`)
    .all({ ...policyWorkParams(input), at: input.at, limit: input.limit }).map(parsePolicyWork);
}

export function insertPolicyWork(db: Database, record: HindsightPolicyWorkRecord): void {
  const bytes = applicationCommandJsonBytes(record.target);
  db.prepare(`INSERT INTO hindsight_policy_work (authority_epoch_id,bank_id,provider_lineage,bank_generation,work_id,work_kind,
    target_bytes,target_bytes_hash,state,revision,claims,claim_token,claim_until,next_attempt_at,prompt_version,prompt_hash,
    result_bytes,result_bytes_hash,command_request_id,last_failure,created_at,updated_at,finished_at)
    VALUES (:epoch,:bank,:lineage,:generation,:id,:kind,:target,:hash,'ready',1,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,:command,NULL,:at,:at,NULL)`)
    .run({ ...policyWorkParams(record.key), id: record.key.workId, kind: record.target.kind, target: bytes,
      hash: hindsightApplicationBytesHash(bytes), command: record.commandRequestId, at: record.createdAt });
}

export function savePolicyWork(db: Database, input: { previous: HindsightPolicyWorkRecord; next: HindsightPolicyWorkRecord }): void {
  const { previous } = input; const next = HindsightPolicyWorkRecordSchema.parse(input.next);
  if (!sameApplicationValue(previous.key, next.key) || !sameApplicationValue(previous.target, next.target)
    || previous.commandRequestId !== next.commandRequestId || previous.revision + 1 !== next.revision
    || previous.result !== null && !sameApplicationValue(previous.result, next.result)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  const bytes = next.result === null ? null : applicationCommandJsonBytes(next.result);
  const changed = db.prepare(`UPDATE hindsight_policy_work SET state=:state,revision=:revision,claims=:claims,
    claim_token=:token,claim_until=:until,next_attempt_at=:retry,prompt_version=:promptVersion,prompt_hash=:promptHash,
    result_bytes=:result,result_bytes_hash=:resultHash,last_failure=:failure,updated_at=:at,finished_at=:finished
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND provider_lineage=:lineage AND bank_generation=:generation
    AND work_id=:id AND revision=:previous`)
    .run({ ...policyWorkParams(next.key), id: next.key.workId, previous: previous.revision, state: next.state, revision: next.revision,
      claims: next.claims, token: next.claimToken, until: next.claimUntil, retry: next.nextAttemptAt,
      promptVersion: next.prompt?.promptVersion ?? null, promptHash: next.prompt?.promptHash ?? null,
      result: bytes, resultHash: bytes === null ? null : hindsightApplicationBytesHash(bytes), failure: next.lastFailure,
      at: next.updatedAt, finished: next.finishedAt });
  if (changed.changes !== 1) throw new Error("MEMORY_REVISION_MISMATCH");
}

function parsePolicyWork(row: SqlRow): HindsightPolicyWorkRecord {
  try {
    const record = HindsightPolicyWorkRecordSchema.parse({
      key: { authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, workId: row.work_id,
        namespace: { provider_lineage: row.provider_lineage, bank_generation: row.bank_generation, application_id: "taki" } },
      target: json(row.target_bytes, row.target_bytes_hash), state: row.state, revision: row.revision, claims: row.claims,
      claimToken: row.claim_token, claimUntil: row.claim_until, nextAttemptAt: row.next_attempt_at,
      prompt: row.prompt_version === null && row.prompt_hash === null ? null : { promptVersion: row.prompt_version, promptHash: row.prompt_hash },
      result: row.result_bytes === null ? null : json(row.result_bytes, row.result_bytes_hash), commandRequestId: row.command_request_id,
      lastFailure: row.last_failure, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
    });
    if (record.target.kind !== row.work_kind || record.key.workId !== hindsightPolicyWorkIdentity(record.key, record.target)
      || record.commandRequestId !== `hindsight-${record.key.workId}` || (record.claimToken === null) !== (record.claimUntil === null)
      || record.state === "claimed" && (record.claimToken === null || record.result !== null)
      || (record.state === "completed" || record.state === "superseded") !== (record.finishedAt !== null)
      || (record.state === "saved" || record.state === "completed") && record.result === null) invalid();
    validateHindsightPolicyWorkTarget(record.key, record.target);
    if (record.result) validateHindsightPolicyWorkResult(record, record.result);
    return record;
  } catch { return invalid(); }
}
function json(bytes: unknown, hash: unknown) {
  if (!(bytes instanceof Uint8Array) || hindsightApplicationBytesHash(bytes) !== hash) invalid();
  return applicationCommandJsonValue(bytes);
}
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR"); }
