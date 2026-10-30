/**
 * INPUT:  typed D77 requests and the common authenticated Hindsight requester
 * OUTPUT: bounded application-state methods with exact response namespace and operation checks
 * POS:    core/memory/hindsight — transport only; receipt verification and replica publication are separate steps
 */
import { z } from "zod";
import {
  TakiApplicationInitializeResponseSchema, TakiApplicationBodyRefSchema, TakiApplicationNamespaceSchema,
  HINDSIGHT_APPLICATION_RESPONSE_BYTES, type TakiApplicationNamespace, type TakiApplicationInitializeResponse,
  type TakiApplicationBodyRef,
  TakiApplicationBodyUploadRequestSchema, TakiApplicationBodyUploadStatusSchema, TakiApplicationBodyPartRequestSchema,
  TakiApplicationBodyPartReceiptSchema, TakiApplicationBodyPartSchema, type TakiApplicationBodyUploadRequest,
  type TakiApplicationBodyUploadStatus, type TakiApplicationBodyPartRequest, type TakiApplicationBodyPartReceipt, type TakiApplicationBodyPart,
  TakiApplicationCommitRequestSchema, TakiApplicationCommitReceiptSchema, TakiApplicationCommitStatusSchema,
  TakiApplicationErrorResponseSchema, type TakiApplicationCommitRequest, type TakiApplicationCommitReceipt,
  type TakiApplicationCommitStatus, type TakiApplicationErrorResponse,
  TakiApplicationHydrateRequestSchema, TakiApplicationSnapshotRequestSchema, TakiApplicationReadBundleManifestSchema,
  TakiApplicationRecordPageSchema, TakiApplicationStateChangePageSchema, TakiApplicationReflectRequestSchema,
  TakiApplicationReflectResponseSchema, type TakiApplicationHydrateRequest, type TakiApplicationSnapshotRequest,
  type TakiApplicationReadBundleManifest, type TakiApplicationRecordPage, type TakiApplicationStateChangePage,
  type TakiApplicationReflectRequest, type TakiApplicationReflectResponse,
} from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";

export interface HindsightApplicationRead { bankId: string; namespace: TakiApplicationNamespace; context: HindsightCallContext }
interface ApplicationPost<T> { bankId: string; request: T; context: HindsightCallContext }
export interface HindsightApplicationClient {
  initializeApplication(input: HindsightApplicationRead): Promise<TakiApplicationInitializeResponse>;
  uploadApplicationBody(input: ApplicationPost<TakiApplicationBodyUploadRequest>): Promise<TakiApplicationBodyUploadStatus>;
  applicationBody(input: HindsightApplicationRead & { bodyId: string }): Promise<TakiApplicationBodyUploadStatus>;
  putApplicationBodyPart(input: ApplicationPost<TakiApplicationBodyPartRequest> & { bodyId: string; partNumber: number }): Promise<TakiApplicationBodyPartReceipt>;
  applicationBodyPart(input: HindsightApplicationRead & { bodyId: string; partNumber: number }): Promise<TakiApplicationBodyPart>;
  sealApplicationBody(input: ApplicationPost<TakiApplicationBodyUploadRequest> & { bodyId: string }): Promise<TakiApplicationBodyRef>;
  commitApplication(input: ApplicationPost<TakiApplicationCommitRequest>): Promise<TakiApplicationCommitReceipt>;
  applicationCommit(input: HindsightApplicationRead & { operationId: string }): Promise<TakiApplicationCommitStatus>;
  hydrateApplication(input: ApplicationPost<TakiApplicationHydrateRequest>): Promise<TakiApplicationReadBundleManifest>;
  createApplicationSnapshot(input: ApplicationPost<TakiApplicationSnapshotRequest>): Promise<TakiApplicationReadBundleManifest>;
  applicationSnapshot(input: HindsightApplicationRead & { snapshotId: string }): Promise<TakiApplicationReadBundleManifest>;
  applicationSnapshotPage(input: HindsightApplicationRead & { snapshotId: string; pageNumber: number }): Promise<TakiApplicationRecordPage>;
  applicationChanges(input: HindsightApplicationRead & { afterStateCursor: number; limit: number }): Promise<TakiApplicationStateChangePage>;
  applicationChangePage(input: HindsightApplicationRead & { stateCursor: number; pageNumber: number; eventHash: string }): Promise<TakiApplicationRecordPage>;
  pruneApplicationChanges(input: HindsightApplicationRead & { throughStateCursor: number }): Promise<TakiApplicationInitializeResponse>;
  reflectApplication(input: ApplicationPost<TakiApplicationReflectRequest>): Promise<TakiApplicationReflectResponse>;
}

export class HindsightApplicationRefusal extends Error {
  readonly refusal: TakiApplicationErrorResponse;
  constructor(refusal: TakiApplicationErrorResponse) {
    super(`HINDSIGHT_APPLICATION_${refusal.code.toUpperCase()}`);
    this.name = "HindsightApplicationRefusal";
    // Provider detail strings are untrusted and may contain content. Only a closed code becomes a diagnostic.
    this.refusal = { ...refusal, detail: refusal.code };
  }
}

type Requester = <T>(input: HindsightRequestInput<T>) => Promise<T>;
type ApplicationCall = <T>(input: HindsightApplicationRead & {
  suffix: string; schema: z.ZodType<T>; body?: unknown; method?: "POST" | "PUT"; query?: Record<string, string>;
}) => Promise<T>;

export function createHindsightApplicationMethods(request: Requester): HindsightApplicationClient {
  const call = applicationCaller(request);
  return { ...bodyMethods(call), ...readMethods(call), ...operationMethods(call),
    initializeApplication: (input) => call({ ...input, suffix: "/initialize", schema: TakiApplicationInitializeResponseSchema,
      body: { namespace: TakiApplicationNamespaceSchema.parse(input.namespace) } }),
    pruneApplicationChanges: (input) => call({ ...input, suffix: "/prune", schema: TakiApplicationInitializeResponseSchema,
      body: { namespace: input.namespace, through_state_cursor: integer(input.throughStateCursor) } }),
  };
}

function bodyMethods(call: ApplicationCall): Pick<HindsightApplicationClient,
  "uploadApplicationBody" | "applicationBody" | "putApplicationBodyPart" | "applicationBodyPart" | "sealApplicationBody"> {
  return {
    uploadApplicationBody: (input) => call({ ...input, namespace: input.request.namespace, suffix: "/bodies",
      body: TakiApplicationBodyUploadRequestSchema.parse(input.request), schema: TakiApplicationBodyUploadStatusSchema }),
    applicationBody: (input) => call({ ...input, suffix: `/bodies/${uuid(input.bodyId)}`, schema: TakiApplicationBodyUploadStatusSchema }),
    putApplicationBodyPart: async (input) => {
      const result = await call({ ...input, namespace: input.request.namespace,
        suffix: `/bodies/${uuid(input.bodyId)}/parts/${integer(input.partNumber)}`, method: "PUT",
        body: TakiApplicationBodyPartRequestSchema.parse(input.request), schema: TakiApplicationBodyPartReceiptSchema });
      assertPart(result, input); return result;
    },
    applicationBodyPart: async (input) => {
      const result = await call({ ...input, suffix: `/bodies/${uuid(input.bodyId)}/parts/${integer(input.partNumber)}`,
        schema: TakiApplicationBodyPartSchema });
      assertPart(result, input); return result;
    },
    sealApplicationBody: async (input) => {
      const result = await call({ ...input, namespace: input.request.namespace, suffix: `/bodies/${uuid(input.bodyId)}/seal`,
        body: TakiApplicationBodyUploadRequestSchema.parse(input.request), schema: TakiApplicationBodyRefSchema });
      if (JSON.stringify(result) !== JSON.stringify(TakiApplicationBodyRefSchema.parse(input.request.descriptor))) invalid();
      return result;
    },
  };
}

function readMethods(call: ApplicationCall): Pick<HindsightApplicationClient, "hydrateApplication" | "createApplicationSnapshot"
  | "applicationSnapshot" | "applicationSnapshotPage" | "applicationChanges" | "applicationChangePage"> {
  return {
    hydrateApplication: async (input) => {
      const result = await call({ ...input, namespace: input.request.namespace, suffix: "/hydrate",
        body: TakiApplicationHydrateRequestSchema.parse(input.request), schema: TakiApplicationReadBundleManifestSchema });
      if (result.request_id !== input.request.request_id || result.kind !== "hydrate") invalid(); return result;
    },
    createApplicationSnapshot: async (input) => {
      const result = await call({ ...input, namespace: input.request.namespace, suffix: "/snapshots",
        body: TakiApplicationSnapshotRequestSchema.parse(input.request), schema: TakiApplicationReadBundleManifestSchema });
      if (result.request_id !== input.request.request_id || result.kind !== "snapshot") invalid(); return result;
    },
    applicationSnapshot: async (input) => {
      const result = await call({ ...input, suffix: `/snapshots/${uuid(input.snapshotId)}`, schema: TakiApplicationReadBundleManifestSchema });
      if (result.snapshot_id !== input.snapshotId) invalid(); return result;
    },
    applicationSnapshotPage: async (input) => {
      const result = await call({ ...input, suffix: `/snapshots/${uuid(input.snapshotId)}/pages/${integer(input.pageNumber)}`,
        schema: TakiApplicationRecordPageSchema });
      if (result.page_number !== input.pageNumber) invalid(); return result;
    },
    applicationChanges: async (input) => {
      const result = await call({ ...input, suffix: "/changes", schema: TakiApplicationStateChangePageSchema,
        query: { after_state_cursor: String(integer(input.afterStateCursor)), limit: String(z.int().min(1).max(128).parse(input.limit)) } });
      if (result.from_checkpoint.state_cursor !== input.afterStateCursor) invalid(); return result;
    },
    applicationChangePage: async (input) => {
      const result = await call({ ...input, suffix: `/changes/${z.int().positive().parse(input.stateCursor)}/pages/${integer(input.pageNumber)}`,
        query: { event_hash: z.string().regex(/^[0-9a-f]{64}$/).parse(input.eventHash) }, schema: TakiApplicationRecordPageSchema });
      if (result.page_number !== input.pageNumber) invalid(); return result;
    },
  };
}

function operationMethods(call: ApplicationCall): Pick<HindsightApplicationClient, "commitApplication" | "applicationCommit" | "reflectApplication"> {
  return {
    commitApplication: async (input) => {
      const result = await call({ ...input, namespace: input.request.namespace, suffix: "/commits",
        body: TakiApplicationCommitRequestSchema.parse(input.request), schema: TakiApplicationCommitReceiptSchema });
      if (result.operation_id !== input.request.operation_id || result.request_hash !== input.request.request_hash) invalid(); return result;
    },
    applicationCommit: async (input) => {
      const result = await call({ ...input, suffix: `/commits/${uuid(input.operationId)}`, schema: TakiApplicationCommitStatusSchema });
      if (result.operation_id !== input.operationId || (result.receipt !== null && result.receipt.operation_id !== input.operationId)) invalid();
      return result;
    },
    reflectApplication: async (input) => {
      const result = await call({ ...input, namespace: input.request.namespace, suffix: "/reflect",
        body: TakiApplicationReflectRequestSchema.parse(input.request), schema: TakiApplicationReflectResponseSchema });
      if (result.request_id !== input.request.request_id) invalid(); return result;
    },
  };
}

function applicationCaller(request: Requester): ApplicationCall {
  return async <T>(input: Parameters<ApplicationCall>[0] & { schema: z.ZodType<T> }): Promise<T> => {
    const bankId = z.string().min(1).max(256).parse(input.bankId);
    if (bankId === "." || bankId === "..") invalid();
    const namespace = TakiApplicationNamespaceSchema.parse(input.namespace);
    const query = new URLSearchParams({ provider_lineage: namespace.provider_lineage,
      bank_generation: namespace.bank_generation, ...input.query });
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body !== undefined && new TextEncoder().encode(body).byteLength > HINDSIGHT_APPLICATION_RESPONSE_BYTES) invalid();
    const result = await request<T | TakiApplicationErrorResponse>({
      path: `/ext/taki-memory/banks/${encodeURIComponent(bankId)}/application-state${input.suffix}${body === undefined ? `?${query}` : ""}`,
      context: input.context, schema: input.schema, maxResponseBytes: HINDSIGHT_APPLICATION_RESPONSE_BYTES,
      init: body === undefined ? undefined : { method: input.method ?? "POST", body },
      responses: { 400: TakiApplicationErrorResponseSchema, 404: TakiApplicationErrorResponseSchema,
        409: TakiApplicationErrorResponseSchema, 410: TakiApplicationErrorResponseSchema, 412: TakiApplicationErrorResponseSchema,
        413: TakiApplicationErrorResponseSchema, 422: TakiApplicationErrorResponseSchema, 503: TakiApplicationErrorResponseSchema },
    });
    if (typeof result === "object" && result !== null && "error" in result) throw new HindsightApplicationRefusal(TakiApplicationErrorResponseSchema.parse(result));
    assertNamespace(result, { bankId, namespace }); return result as T;
  };
}

function assertNamespace(result: unknown, expected: { bankId: string; namespace: TakiApplicationNamespace }): void {
  if (result === null || typeof result !== "object") invalid();
  if ("bank_id" in result && result.bank_id !== expected.bankId) invalid();
  if ("namespace" in result) {
    const namespace = TakiApplicationNamespaceSchema.parse(result.namespace);
    if (namespace.provider_lineage !== expected.namespace.provider_lineage || namespace.bank_generation !== expected.namespace.bank_generation
      || namespace.application_id !== expected.namespace.application_id) invalid();
  }
}
function assertPart(result: TakiApplicationBodyPartReceipt, expected: { bodyId: string; partNumber: number }): void {
  if (result.body_id !== expected.bodyId || result.part_number !== expected.partNumber) invalid();
}
function uuid(value: string): string { return z.uuid().parse(value); }
function integer(value: number): number { return z.int().min(0).parse(value); }
function invalid(): never { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
