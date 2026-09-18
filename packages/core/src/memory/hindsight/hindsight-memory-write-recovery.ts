/**
 * INPUT:  a Bank recovery lease, current native Pending progress and original parent write intents
 * OUTPUT: whole-operation completion only after every required native/application effect is verified
 * POS:    core/memory/hindsight — invoked by the existing Bank recovery service; no timer or model work
 */
import type { MemoryErrorCode, PendingMemoryRecord } from "@taki/shared";
import type { HindsightMemoryWriteJob } from "../../db/hindsight-memory-write-contract.ts";
import { hindsightApplicationDeadline } from "./hindsight-application-body-transfer.ts";
import { hindsightMemoryWriteChild } from "./hindsight-memory-write-result.ts";
import { completeHindsightMemoryRetain } from "./hindsight-memory-write-retain.ts";
import { completeHindsightMemoryMutation } from "./hindsight-memory-write-mutation.ts";
import type { HindsightMemoryWriteAdvance, HindsightMemoryWriteDeps } from "./hindsight-memory-write-context.ts";

export async function advanceHindsightMemoryWrites(deps: HindsightMemoryWriteDeps, input: HindsightMemoryWriteAdvance): Promise<void> {
  const remaining = hindsightApplicationDeadline(input.context); let afterSequence = 0;
  const namespace = deps.replica.checkpoint(input.bankId)?.namespace;
  if (!namespace) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  for (;;) {
    remaining();
    const jobs = deps.journal.pending({ authorityEpochId: deps.epochId, bankId: input.bankId, namespace, afterSequence });
    if (jobs.length === 0) return;
    for (const job of jobs) {
      afterSequence = job.sequence;
      const request = () => { const value = remaining(); deps.assertActive(job.identity); return value; };
      request(); const child = hindsightMemoryWriteChild(deps, job);
      if (child?.phase === "failed" || child?.phase === "cancelled") { failed(deps, job, child); continue; }
      if (job.identity.operation.kind === "retain") {
        if (child) await completeHindsightMemoryRetain(deps, { job, child, request });
      } else await completeHindsightMemoryMutation(deps, { job, child, request, refresh: input.refresh });
      request();
    }
  }
}

function failed(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob, child: PendingMemoryRecord): void {
  let code: MemoryErrorCode = "MEMORY_INTERNAL_ERROR";
  if (child.phase === "cancelled") code = "MEMORY_OPERATION_CANCELLED";
  else if (child.diagnosticCode?.includes("IDENTITY_CONFLICT")) code = "MEMORY_REQUEST_ID_CONFLICT";
  else if (child.diagnosticCode?.includes("PAYLOAD")) code = "MEMORY_INVALID_REQUEST";
  deps.journal.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "error", code } });
}
