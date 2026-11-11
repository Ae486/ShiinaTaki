/**
 * INPUT:  the active Authority Epoch and one Bank's persisted Pending recovery metadata
 * OUTPUT: one aggregate of unresolved/accepted waits, next retry and an actual blocking diagnostic
 * POS:    core/db — scheduler settlement read; no payload materialization or additional Native observation
 */
import { z } from "zod";
import { MemoryReplicaErrorCodeSchema } from "@taki/shared";
import type { Database } from "./sqlite.ts";

const RecoveryStateSchema = z.object({
  unresolvedCount: z.int().min(0), waitingCount: z.int().min(0),
  nextRetryAt: z.iso.datetime({ offset: true }).nullable(), blockingErrorCode: MemoryReplicaErrorCodeSchema.nullable(),
});
export type PendingRecoveryState = z.infer<typeof RecoveryStateSchema>;

export function readPendingRecoveryState(db: Database, bankId: string): PendingRecoveryState {
  return RecoveryStateSchema.parse(db.prepare(`WITH pending_state AS (
    SELECT pending.phase, json_extract(state_json,'$.acceptedAt') AS accepted,
      json_extract(state_json,'$.diagnosticCode') AS diagnostic,
      json_extract(state_json,'$.nextRetryAt') AS retry_at,
      json_extract(state_json,'$.dispatch.protocol') AS protocol,
      json_extract(state_json,'$.nativeStatus.status') AS native_status,
      json_type(state_json,'$.nativeReceipt')='object' OR json_type(state_json,'$.nativeResultReceipt')='object' AS receipt
    FROM pending_memory AS pending JOIN canonical_memory_authority_state AS authority
      ON authority.active_epoch_id=pending.authority_epoch_id AND authority.singleton=1
    WHERE pending.bank_id=:bank AND pending.phase IN ('queued','submitted','awaiting_derived','awaiting_pull','failed','outcome_unknown')
  ), classified AS (
    SELECT *, CASE WHEN accepted IS NOT NULL AND (diagnostic IS NULL OR diagnostic='HINDSIGHT_PENDING_REMAINS')
      AND ((phase='submitted' AND (coalesce(protocol,'legacy')<>'tracked_native_v1' OR native_status IN ('pending','processing','partial')))
        OR (phase IN ('awaiting_derived','awaiting_pull') AND receipt)) THEN 1 ELSE 0 END AS waiting
    FROM pending_state
  ) SELECT count(*) AS unresolvedCount, coalesce(sum(waiting),0) AS waitingCount, min(retry_at) AS nextRetryAt,
    min(CASE WHEN waiting=0 THEN coalesce(nullif(diagnostic,'HINDSIGHT_PENDING_REMAINS'),
      CASE WHEN phase='outcome_unknown' THEN 'HINDSIGHT_PENDING_OUTCOME_UNKNOWN'
        WHEN phase='failed' THEN 'HINDSIGHT_PENDING_OPERATION_FAILED'
        WHEN protocol='tracked_native_v1' AND (native_status IS NULL OR native_status NOT IN ('pending','processing','partial'))
          THEN 'HINDSIGHT_NATIVE_RESULT_UNAVAILABLE'
        ELSE 'HINDSIGHT_PENDING_REMAINS' END) END) AS blockingErrorCode FROM classified`)
    .get({ bank: bankId }));
}
