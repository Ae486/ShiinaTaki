/**
 * INPUT:  frozen D78 messages and the existing authenticated HTTP requester
 * OUTPUT: structured-transfer and finite-verification methods with bounded typed refusals
 * POS:    core/memory/hindsight — no implicit retry; only D78 snapshots receive the larger response budget
 */
import { z } from "zod";
import { HindsightCurrentTransferResultSchema, HindsightCurrentTransferFailureSchema, HindsightCurrentMappingPageSchema,
  HindsightCutoverVerificationStatusSchema, HindsightCutoverVerificationFailureSchema, HindsightCutoverEvidencePageSchema,
  HindsightSnapshotMetadataWireSchema, HindsightSnapshotPageWireSchema, HINDSIGHT_CURRENT_STATE_MAX_BYTES,
  type HindsightCurrentTransferRequest, type HindsightCurrentTransferResult, type HindsightCurrentTransferFailure,
  type HindsightCurrentMappingPage, type HindsightCutoverVerificationRequest, type HindsightCutoverVerificationStatus,
  type HindsightCutoverVerificationFailure, type HindsightCutoverEvidencePage,
  type HindsightSnapshotMetadataWire, type HindsightSnapshotPageWire } from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";

interface CurrentRead { bankId: string; operationId: string; providerLineage: string; bankGeneration: string; context: HindsightCallContext }
type TransferResponse = HindsightCurrentTransferResult | HindsightCurrentTransferFailure;
type VerifyResponse = HindsightCutoverVerificationStatus | HindsightCutoverVerificationFailure;
export interface HindsightCurrentStateClient {
  transferCurrentState(input: { bankId: string; request: HindsightCurrentTransferRequest; context: HindsightCallContext }): Promise<TransferResponse>;
  currentTransferResult(input: CurrentRead): Promise<TransferResponse>;
  currentTransferPage(input: CurrentRead & { pageNumber: number }): Promise<HindsightCurrentMappingPage | HindsightCurrentTransferFailure>;
  prepareCurrentVerification(input: { bankId: string; request: HindsightCutoverVerificationRequest; context: HindsightCallContext }): Promise<VerifyResponse>;
  advanceCurrentVerification(input: CurrentRead & { expectedRevision: number }): Promise<VerifyResponse>;
  currentVerification(input: CurrentRead): Promise<VerifyResponse>;
  currentVerificationPage(input: CurrentRead & { certificateHash: string; pageNumber: number }): Promise<HindsightCutoverEvidencePage | HindsightCutoverVerificationFailure>;
  createCurrentSnapshot(input: { bankId: string; ttlSeconds: number; context: HindsightCallContext }): Promise<HindsightSnapshotMetadataWire>;
  currentSnapshotPage(input: { bankId: string; snapshotId: string; pageNumber: number; context: HindsightCallContext }): Promise<HindsightSnapshotPageWire>;
}

export function createHindsightCurrentMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightCurrentStateClient {
  const transfer = z.union([HindsightCurrentTransferResultSchema, HindsightCurrentTransferFailureSchema]);
  const verification = z.union([HindsightCutoverVerificationStatusSchema, HindsightCutoverVerificationFailureSchema]);
  return {
    transferCurrentState: (input) => {
      const body = JSON.stringify(input.request);
      if (new TextEncoder().encode(body).byteLength > HINDSIGHT_CURRENT_STATE_MAX_BYTES) throw new Error("HINDSIGHT_CURRENT_REQUEST_LIMIT");
      return request({ path: `${bankPath(input.bankId)}/current-state-transfers`, init: { method: "POST", body },
        context: input.context, schema: transfer, responses: errors(HindsightCurrentTransferFailureSchema) });
    },
    currentTransferResult: (input) => request({ path: `${transferPath(input)}?${namespace(input)}`,
      context: input.context, schema: transfer, responses: errors(HindsightCurrentTransferFailureSchema) }),
    currentTransferPage: (input) => {
      const schema = z.union([HindsightCurrentMappingPageSchema, HindsightCurrentTransferFailureSchema]);
      return request({ path: `${transferPath(input)}/mappings/${input.pageNumber}?${namespace(input)}`,
        context: input.context, schema, responses: errors(HindsightCurrentTransferFailureSchema) });
    },
    prepareCurrentVerification: (input) => request({ path: `${bankPath(input.bankId)}/cutover-verifications`,
      init: { method: "POST", body: JSON.stringify(input.request) }, context: input.context, schema: verification, responses: errors(HindsightCutoverVerificationFailureSchema) }),
    advanceCurrentVerification: (input) => request({ path: `${verificationPath(input)}/verify?${namespace(input)}`,
      init: { method: "POST", body: JSON.stringify({ expected_revision: input.expectedRevision }) },
      context: input.context, schema: verification, responses: errors(HindsightCutoverVerificationFailureSchema) }),
    currentVerification: (input) => request({ path: `${verificationPath(input)}?${namespace(input)}`,
      context: input.context, schema: verification, responses: errors(HindsightCutoverVerificationFailureSchema) }),
    currentVerificationPage: (input) => {
      const schema = z.union([HindsightCutoverEvidencePageSchema, HindsightCutoverVerificationFailureSchema]);
      return request({ path: `${verificationPath(input)}/certificates/${input.certificateHash}/pages/${input.pageNumber}?${namespace(input)}`,
        context: input.context, schema, responses: errors(HindsightCutoverVerificationFailureSchema), maxResponseBytes: HINDSIGHT_CURRENT_STATE_MAX_BYTES });
    },
    createCurrentSnapshot: (input) => request({ path: `${bankPath(input.bankId)}/snapshots`,
      init: { method: "POST", body: JSON.stringify({ page_size: 1, ttl_seconds: input.ttlSeconds }) },
      context: input.context, schema: HindsightSnapshotMetadataWireSchema }),
    currentSnapshotPage: (input) => request({ path: `${bankPath(input.bankId)}/snapshots/${encodeURIComponent(input.snapshotId)}/pages/${input.pageNumber}`,
      context: input.context, schema: HindsightSnapshotPageWireSchema, maxResponseBytes: HINDSIGHT_CURRENT_STATE_MAX_BYTES }),
  };
}

function errors<T>(schema: { parse: (value: unknown) => T }) {
  return { 400: schema, 403: schema, 404: schema, 409: schema, 412: schema, 413: schema, 422: schema, 503: schema };
}
function bankPath(bankId: string): string { return `/ext/taki-memory/banks/${encodeURIComponent(bankId)}`; }
function transferPath(input: CurrentRead): string { return `${bankPath(input.bankId)}/current-state-transfers/${encodeURIComponent(input.operationId)}`; }
function verificationPath(input: CurrentRead): string { return `${bankPath(input.bankId)}/cutover-verifications/${encodeURIComponent(input.operationId)}`; }
function namespace(input: CurrentRead): URLSearchParams {
  return new URLSearchParams({ provider_lineage: input.providerLineage, bank_generation: input.bankGeneration });
}
