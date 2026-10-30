/**
 * INPUT:  setup.validate / setup.apply requests and the live B3 HindsightSetupService
 * OUTPUT: the two setup kind handlers — settlement classified from the persisted setup snapshot the service returns
 * POS:    core/memory/operations — thin wrapper; the setup service keeps its own revision/idle guards and legacy RPCs
 */
import { HindsightErrorCodeSchema, type MemoryOperationProducerRef, type MemoryOperationRequest, type MemoryReplicaErrorCode } from "@taki/shared";
import { HindsightError } from "../hindsight/hindsight-errors.ts";
import type { MemoryOperationContext, MemoryOperationKindHandler, MemoryOperationSettlement } from "./memory-operation-contract.ts";

type ValidateRequest = Extract<MemoryOperationRequest, { kind: "setup.validate" }>;
type ApplyRequest = Extract<MemoryOperationRequest, { kind: "setup.apply" }>;
type SetupRef = Extract<MemoryOperationProducerRef, { kind: "setup" }>;

export const setupValidateKind: MemoryOperationKindHandler<ValidateRequest> = {
  family: () => "setup",
  admit: (_request, ctx) => producerRef(ctx),
  execute: async ({ request, producer, ctx, running }) => {
    running();
    return settle(ctx, producer, () => ctx.setup.validate({ expectedRevision: request.expectedRevision }));
  },
};

export const setupApplyKind: MemoryOperationKindHandler<ApplyRequest> = {
  family: () => "setup",
  admit: (_request, ctx) => producerRef(ctx),
  execute: async ({ request, producer, ctx, running }) => {
    running();
    return settle(ctx, producer, () => ctx.setup.setup({
      expectedRevision: request.expectedRevision, characterId: request.characterId,
      ...(request.managedReceipt ? { managedReceipt: request.managedReceipt } : {}),
    }));
  },
};

function producerRef(ctx: MemoryOperationContext): SetupRef {
  return { kind: "setup", attemptId: null, revisionBefore: ctx.setup.status().revision, revisionAfter: null };
}

async function settle(
  ctx: MemoryOperationContext,
  ref: MemoryOperationProducerRef,
  run: () => Promise<ReturnType<MemoryOperationContext["setup"]["status"]>>,
): Promise<MemoryOperationSettlement> {
  if (ref.kind !== "setup") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  const producer: SetupRef = ref;
  try {
    const snapshot = await run();
    const failed = snapshot.phase === "failed";
    return {
      state: failed ? "failed" : "completed",
      reason: failed ? "producer_failed" : null,
      errorCode: failed ? snapshot.latestError?.code ?? "HINDSIGHT_RESPONSE_INVALID" : null,
      result: { kind: "setup", phase: snapshot.phase, revision: snapshot.revision, latestError: snapshot.latestError },
      producer: { ...producer, attemptId: snapshot.attemptId, revisionAfter: snapshot.revision },
    };
  } catch (error) {
    // The service refused before persisting an attempt; the snapshot it reports is unchanged truth, not this attempt's outcome.
    const snapshot = ctx.setup.status();
    return {
      state: "failed", reason: "producer_refused", errorCode: refusalCode(error),
      result: { kind: "setup", phase: snapshot.phase, revision: snapshot.revision, latestError: snapshot.latestError },
      producer: { ...producer, attemptId: null, revisionAfter: snapshot.revision },
    };
  }
}

function refusalCode(error: unknown): MemoryReplicaErrorCode {
  if (error instanceof HindsightError) return error.code;
  const parsed = HindsightErrorCodeSchema.safeParse(error instanceof Error ? error.message : undefined);
  return parsed.success ? parsed.data : "HINDSIGHT_RESPONSE_INVALID";
}
