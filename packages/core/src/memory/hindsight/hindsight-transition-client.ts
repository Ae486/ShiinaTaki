/**
 * INPUT:  strict transition protocol requests and the authenticated bounded HTTP requester
 * OUTPUT: native fence/delta/proof/history methods with exact identity checks and no implicit retries
 * POS:    Core provider adapter — W3-W6 compose these primitives; no transition driver is enabled
 */
import { z } from "zod";
import { HINDSIGHT_TRANSITION_MAX_BYTES, HindsightTransitionAcquireSchema, HindsightTransitionClaimSchema,
  HindsightTransitionExecutorSchema, HindsightTransitionOutcomeRequestSchema, HindsightTransitionStatusSchema,
  HindsightTransitionUnusedScopeSchema, HindsightTransitionDeltaRequestSchema, HindsightTransitionDeltaResultSchema,
  HindsightTransitionFailureSchema, HindsightTransitionAuxiliaryPageSchema, HindsightCutoverEvidencePageSchema,
  type HindsightTransitionAcquire, type HindsightTransitionClaim, type HindsightTransitionExecutor,
  type HindsightTransitionOutcomeRequest, type HindsightTransitionStatus, type HindsightTransitionUnusedScope,
  type HindsightTransitionDeltaRequest, type HindsightTransitionDeltaResult, type HindsightTransitionFailure,
  type HindsightTransitionAuxiliaryPage, type HindsightCutoverEvidencePage } from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { hindsightTransitionHash, signHindsightTransitionAcquire, signHindsightTransitionDelta, validateHindsightUnusedScope,
  validateHindsightTransitionStatus, validateHindsightTransitionDelta } from "./hindsight-transition-proof.ts";
import { probeHindsightTransitionSourceCapability } from "./hindsight-transition-source-capability.ts";

interface Read { bankId: string; transitionId: string; context: HindsightCallContext }
interface Post<T> { bankId: string; request: T; context: HindsightCallContext }
export interface HindsightTransitionClient {
  unusedTransitionScope(input: { bankId: string; context: HindsightCallContext }): Promise<HindsightTransitionUnusedScope>;
  acquireTransition(input: Post<HindsightTransitionAcquire>): Promise<HindsightTransitionStatus>;
  transitionStatus(input: Read): Promise<HindsightTransitionStatus>;
  claimTransition(input: Read & { request: HindsightTransitionClaim }): Promise<HindsightTransitionStatus>;
  renewTransition(input: Post<HindsightTransitionExecutor>): Promise<HindsightTransitionStatus>;
  fenceTransition(input: Post<HindsightTransitionExecutor>): Promise<HindsightTransitionStatus>;
  verifyTransition(input: Post<HindsightTransitionExecutor>): Promise<HindsightTransitionStatus>;
  resolveTransition(input: Post<HindsightTransitionOutcomeRequest>): Promise<HindsightTransitionStatus>;
  applyTransitionDelta(input: Post<HindsightTransitionDeltaRequest>): Promise<HindsightTransitionDeltaResult>;
  transitionDelta(input: Read): Promise<HindsightTransitionDeltaResult | null>;
  transitionEvidence(input: Read & { proofHash: string; pageNumber: number }): Promise<HindsightCutoverEvidencePage>;
  transitionAuxiliary(input: Read & { proofHash: string; pageNumber: number }): Promise<HindsightTransitionAuxiliaryPage>;
}
export class HindsightTransitionRefusal extends Error {
  readonly refusal: HindsightTransitionFailure;
  constructor(refusal: HindsightTransitionFailure) {
    super(`HINDSIGHT_TRANSITION_${refusal.reason.toUpperCase()}`);
    this.name = "HindsightTransitionRefusal"; this.refusal = refusal;
  }
}
type Requester = <T>(input: HindsightRequestInput<T>) => Promise<T>;
type Call = <T>(input: { bankId: string; suffix: string; schema: z.ZodType<T>; context: HindsightCallContext; body?: unknown }) => Promise<T>;

export function createHindsightTransitionMethods(request: Requester): HindsightTransitionClient {
  const call = hindsightTransitionCaller(request);
  const status = async (input: Parameters<Call>[0] & { transitionId: string; requestHash?: string; executor?: HindsightTransitionExecutor }): Promise<HindsightTransitionStatus> => {
    const result = await call({ ...input, schema: HindsightTransitionStatusSchema });
    validateHindsightTransitionStatus(result, input);
    if (input.requestHash && input.requestHash !== result.request.request_hash
      || input.executor && hindsightTransitionHash(input.executor) !== hindsightTransitionHash(result.executor)) invalid();
    return result;
  };
  const executor = (input: Post<HindsightTransitionExecutor>, suffix: string) => status({ ...input, suffix,
    schema: HindsightTransitionStatusSchema, transitionId: input.request.transition_id, executor: input.request, body: HindsightTransitionExecutorSchema.parse(input.request) });
  return { ...deltaMethods(call, request), ...pageMethods(call),
    unusedTransitionScope: async (input) => {
      const result = await call({ ...input, suffix: "/unused-scope", schema: HindsightTransitionUnusedScopeSchema, body: {} });
      validateHindsightUnusedScope(result, input.bankId); return result;
    },
    acquireTransition: (input) => {
      const body = HindsightTransitionAcquireSchema.parse(input.request);
      if (body.request_hash !== signHindsightTransitionAcquire(input.bankId, body).request_hash) invalid();
      return status({ ...input, suffix: "", schema: HindsightTransitionStatusSchema, transitionId: body.transition_id, requestHash: body.request_hash, body });
    },
    transitionStatus: (input) => status({ ...input, suffix: `/${uuid(input.transitionId)}`, schema: HindsightTransitionStatusSchema }),
    claimTransition: async (input) => {
      const body = HindsightTransitionClaimSchema.parse(input.request);
      const result = await status({ ...input, suffix: `/${uuid(input.transitionId)}/claim`, schema: HindsightTransitionStatusSchema, body });
      if (result.executor.attempt_id !== body.attempt_id || result.revision !== body.expected_revision + 1
        || result.executor.generation < 2 || result.outcome !== null) invalid();
      return result;
    },
    renewTransition: (input) => executor(input, "/executor/renew"), fenceTransition: (input) => executor(input, "/executor/fence"),
    verifyTransition: (input) => executor(input, "/executor/verify"),
    resolveTransition: async (input) => {
      const body = HindsightTransitionOutcomeRequestSchema.parse(input.request);
      const result = await status({ ...input, suffix: "/executor/outcome", schema: HindsightTransitionStatusSchema,
        transitionId: body.executor.transition_id, body });
      if (!result.outcome || hindsightTransitionHash(result.outcome.request) !== hindsightTransitionHash(body)) invalid();
      return result;
    },
  };
}
function deltaMethods(call: Call, request: Requester): Pick<HindsightTransitionClient, "applyTransitionDelta" | "transitionDelta"> {
  return {
    applyTransitionDelta: async (input) => {
      const body = HindsightTransitionDeltaRequestSchema.parse(input.request);
      if (body.request_hash !== signHindsightTransitionDelta(input.bankId, body).request_hash) invalid();
      if (body.application.some((item) => item.body?.artifact_kind === "source_evidence" || item.body?.artifact_kind === "memory_evidence")) {
        await probeHindsightTransitionSourceCapability(request, input.context);
      }
      const result = await call({ ...input, suffix: "/executor/delta", schema: HindsightTransitionDeltaResultSchema, body });
      validateHindsightTransitionDelta(result, { bankId: input.bankId, transitionId: body.executor.transition_id, request: body }); return result;
    },
    transitionDelta: async (input) => {
      const result = await call({ ...input, suffix: `/${uuid(input.transitionId)}/delta`, schema: HindsightTransitionDeltaResultSchema.nullable() });
      if (result) validateHindsightTransitionDelta(result, input); return result;
    },
  };
}
function pageMethods(call: Call): Pick<HindsightTransitionClient, "transitionEvidence" | "transitionAuxiliary"> {
  const suffix = (input: Read & { proofHash: string; pageNumber: number }, kind: string) =>
    `/${uuid(input.transitionId)}/${kind}/${z.int().min(0).parse(input.pageNumber)}?proof_hash=${z.string().regex(/^[0-9a-f]{64}$/).parse(input.proofHash)}`;
  return {
    transitionEvidence: async (input) => {
      const page = await call({ ...input, suffix: suffix(input, "evidence"), schema: HindsightCutoverEvidencePageSchema });
      if (page.bank_id !== input.bankId || page.verification_id !== input.transitionId || page.certificate_hash !== input.proofHash || page.page_number !== input.pageNumber
        || page.page_hash !== hindsightTransitionHash({ page_number: page.page_number, records: page.records })) invalid();
      return page;
    },
    transitionAuxiliary: async (input) => {
      const page = await call({ ...input, suffix: suffix(input, "auxiliary"), schema: HindsightTransitionAuxiliaryPageSchema });
      if (page.bank_id !== input.bankId || page.transition_id !== input.transitionId || page.proof_hash !== input.proofHash || page.page_number !== input.pageNumber
        || page.page_hash !== hindsightTransitionHash({ page_number: page.page_number, records: page.records })) invalid();
      return page;
    },
  };
}
export function hindsightTransitionCaller(request: Requester): Call {
  return async <T>(input: Parameters<Call>[0] & { schema: z.ZodType<T> }): Promise<T> => {
    const bankId = z.string().min(1).max(256).parse(input.bankId);
    if (bankId === "." || bankId === "..") invalid();
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body && new TextEncoder().encode(body).byteLength > HINDSIGHT_TRANSITION_MAX_BYTES) invalid();
    const result = await request<T | HindsightTransitionFailure>({ path: `/ext/taki-memory/banks/${encodeURIComponent(bankId)}/transitions${input.suffix}`,
      context: input.context, schema: input.schema, maxResponseBytes: HINDSIGHT_TRANSITION_MAX_BYTES,
      init: body === undefined ? undefined : { method: "POST", body }, responses: {
        401: HindsightTransitionFailureSchema, 403: HindsightTransitionFailureSchema, 404: HindsightTransitionFailureSchema,
        409: HindsightTransitionFailureSchema, 413: HindsightTransitionFailureSchema, 422: HindsightTransitionFailureSchema, 503: HindsightTransitionFailureSchema,
      } });
    if (result && typeof result === "object" && "error" in result) throw new HindsightTransitionRefusal(HindsightTransitionFailureSchema.parse(result));
    return result as T;
  };
}
function uuid(value: string): string { return z.uuid().parse(value); }
function invalid(): never { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
