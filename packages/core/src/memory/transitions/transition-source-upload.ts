/**
 * INPUT: previously persisted exact Source uploads and a current Core/native executor owner
 * OUTPUT: sealed original bytes/IDs through the authenticated transition-owned uploader
 * POS: core/memory/transitions — durable upload replay precedes delta publication, never bypasses ordinary fences
 */
import type { HindsightTransitionExecutor, MemoryTransitionPreparation } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readTransitionSourceUploads, prepareTransitionSourceUploadAttempt } from "../../db/memory-transition-source-upload.ts";
import { assertTransitionLocalCurrent, readTransitionLocalCapture, requireTransitionPreparation,
  type TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import { decodeHindsightApplicationBody } from "../hindsight/hindsight-application-integrity.ts";
import { uploadHindsightApplicationBody } from "../hindsight/hindsight-application-body-transfer.ts";
import type { HindsightTransitionSourceClient } from "../hindsight/hindsight-transition-source-client.ts";
import type { HindsightCallContext } from "../hindsight/hindsight-client.ts";

export function assertTransitionDeltaDispatch(db: Database, input: TransitionCaptureInput, prepared: MemoryTransitionPreparation): void {
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input);
    if (intent.transitionId !== prepared.transitionId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    assertTransitionLocalCurrent(db, readTransitionLocalCapture(db, prepared.captureId));
  });
}
export async function uploadTransitionSources(db: Database, input: TransitionCaptureInput & {
  prepared: MemoryTransitionPreparation; executor: HindsightTransitionExecutor;
  client: Partial<HindsightTransitionSourceClient>; request(): HindsightCallContext;
}): Promise<void> {
  const uploads = readTransitionSourceUploads(db, input.prepared.transitionId)
    .filter((row) => row.localBankId === input.prepared.scope.localBankId);
  if (!uploads.length) return;
  const { uploadTransitionSourceBody, putTransitionSourcePart, sealTransitionSourceBody } = input.client;
  if (!uploadTransitionSourceBody || !putTransitionSourcePart || !sealTransitionSourceBody) {
    throw new Error("HINDSIGHT_TRANSITION_SOURCE_EVIDENCE_UNAVAILABLE");
  }
  for (const upload of uploads) {
    assertTransitionDeltaDispatch(db, input, input.prepared);
    if (upload.captureId !== input.prepared.captureId || upload.nativeBankId !== input.prepared.scope.nativeBankId
      || !input.prepared.request.application.some((row) => row.body?.artifact_kind === "source_evidence"
        && row.body.body.source_ref.body_id === upload.ref.body_id)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const attempt = prepareTransitionSourceUploadAttempt(db, { ...input, upload });
    const body = decodeHindsightApplicationBody({ bankId: upload.nativeBankId, namespace: upload.namespace,
      ref: upload.ref, bytes: Buffer.from(upload.base64, "base64") });
    const guard = () => { input.request(); assertTransitionDeltaDispatch(db, input, input.prepared); };
    await uploadHindsightApplicationBody({ bankId: upload.nativeBankId, namespace: upload.namespace, body, context: input.request(), client: {
      uploadApplicationBody: (call) => { guard(); return uploadTransitionSourceBody.call(input.client, { ...call, request: attempt.request }); },
      putApplicationBodyPart: (call) => { guard(); return putTransitionSourcePart.call(input.client, { ...call,
        request: { ...call.request, executor: attempt.request.executor } }); },
      sealApplicationBody: (call) => { guard(); return sealTransitionSourceBody.call(input.client, { ...call, request: attempt.request }); },
    } });
  }
}
