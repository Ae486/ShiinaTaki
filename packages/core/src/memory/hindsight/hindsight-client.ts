/**
 * INPUT:  an optional injected transport, endpoint policy, and just-in-time API-key resolver
 * OUTPUT: authenticated, bounded Hindsight 0.9.0 operations with prompt cancellation and sanitized errors
 * POS:    core/memory/hindsight — OS-neutral REST seam; no retries, process, filesystem, or authority wiring
 */
import { type HindsightBankLlmHealthProjection, type HindsightErrorCode } from "@taki/shared";
import { addAbortListener } from "node:events";
import { normalizeHindsightEndpoint } from "./hindsight-endpoint-policy.ts";
import { HindsightError, hindsightError } from "./hindsight-errors.ts";
import { HINDSIGHT_DEFAULT_RESPONSE_BYTES, hindsightHttpTransport } from "./hindsight-http-transport.ts";
import {
  HindsightBankLlmHealthWireSchema,
  HindsightBankTemplateManifestSchema,
  HindsightBankWireSchema,
  HindsightCompatibilityWireSchema,
  HindsightHealthWireSchema,
  HindsightOperationStatusWireSchema,
  HindsightTemplateImportWireSchema,
  HindsightVersionWireSchema,
  type HindsightBankTemplateManifest,
  type HindsightCompatibilityWire,
} from "./hindsight-contracts.ts";
import { HindsightDetailedOperationSchema, HindsightDocumentResponseSchema, HindsightFactPageResponseSchema, HindsightRetainResponseSchema, type HindsightImportDocumentWire, type HindsightImportFactWire } from "./hindsight-import-contracts.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { HindsightSnapshotMetadataWireSchema, HindsightSnapshotPageWireSchema, normalizeSnapshotMetadata, normalizeSnapshotPage } from "./hindsight-snapshot-contracts.ts";
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotPage } from "@taki/shared";
import type { HindsightJournalPage } from "@taki/shared";
import { HindsightJournalWireSchema, normalizeHindsightJournal } from "./hindsight-journal-contracts.ts";
import { createHindsightPendingMethods, type HindsightPendingClient } from "./hindsight-pending-client.ts";
import { createHindsightNativeResultMethods, type HindsightNativeResultClient } from "./hindsight-native-result-client.ts";
import { createHindsightCurrentMethods, type HindsightCurrentStateClient } from "./hindsight-current-client.ts";
import { createHindsightRuntimeMethods, type HindsightRuntimeClient } from "./hindsight-runtime-client.ts";
import { createHindsightApplicationMethods, type HindsightApplicationClient } from "./hindsight-application-client.ts";

export interface HindsightTransportResponse {
  status: number;
  headers?: Headers;
  body: string;
}
export type HindsightTransport = (input: string | URL, init?: RequestInit, maxResponseBytes?: number) => Promise<HindsightTransportResponse>;
export interface HindsightCallContext {
  signal?: AbortSignal;
  timeoutMs: number;
  attemptId?: string;
}
export interface HindsightClient extends Partial<HindsightPendingClient>, Partial<HindsightNativeResultClient>, Partial<HindsightCurrentStateClient>, Partial<HindsightRuntimeClient>, Partial<HindsightApplicationClient> {
  health(context: HindsightCallContext): Promise<{ status: "healthy"; database: "connected" }>;
  version(context: HindsightCallContext): Promise<{ apiVersion: string }>;
  compatibility(context: HindsightCallContext): Promise<HindsightCompatibilityWire>;
  createOrUpdateBank(bankId: string, context: HindsightCallContext): Promise<{ bankId: string; name: string | null }>;
  importTemplate(input: {
    bankId: string;
    template: HindsightBankTemplateManifest;
    dryRun: boolean;
    context: HindsightCallContext;
  }): Promise<ReturnType<typeof HindsightTemplateImportWireSchema.parse>>;
  exportTemplate(bankId: string, context: HindsightCallContext): Promise<HindsightBankTemplateManifest>;
  bankLlmHealth(bankId: string, context: HindsightCallContext): Promise<HindsightBankLlmHealthProjection>;
  operationStatus(bankId: string, operationId: string, context: HindsightCallContext): Promise<{ operationId: string; status: "pending" | "processing" | "completed" | "failed" | "cancelled" | "not_found" }>;
  retainImport?: (input: { bankId: string; content: string; documentId: string; operationId: string; context: string | null; call: HindsightCallContext }) => Promise<{ operationId: string; itemsCount: number }>;
  operationImportStatus?: (bankId: string, operationId: string, context: HindsightCallContext) => Promise<{ operationId: string; status: "pending" | "processing" | "completed" | "failed" | "cancelled" | "not_found"; operationType?: string | null; resultMetadataHash: string | null; derivedUnitCount: number | null; extractionErrorCount: number | null }>;
  document?: (bankId: string, documentId: string, context: HindsightCallContext) => Promise<HindsightImportDocumentWire>;
  factPage?: (input: { bankId: string; documentId: string; limit: number; offset: number; context: HindsightCallContext }) => Promise<{ items: HindsightImportFactWire[]; total: number; limit: number; offset: number }>;
  createLogicalSnapshot?: (input: { bankId: string; pageSize: number; ttlSeconds: number; context: HindsightCallContext }) => Promise<HindsightLogicalSnapshotMetadata>;
  logicalSnapshot?: (bankId: string, snapshotId: string, context: HindsightCallContext) => Promise<HindsightLogicalSnapshotMetadata>;
  logicalSnapshotPage?: (input: { bankId: string; snapshotId: string; pageNumber: number; context: HindsightCallContext }) => Promise<HindsightLogicalSnapshotPage>;
  changesAfter?: (input: { bankId: string; afterCursor: number; limit: number; context: HindsightCallContext }) => Promise<HindsightJournalPage>;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

export function createHindsightClient(deps: {
  endpoint: string;
  resolveApiKey: () => string | null;
  transport?: HindsightTransport;
}): HindsightClient {
  const endpoint = normalizeHindsightEndpoint(deps.endpoint);
  const request = <T>(input: HindsightRequestInput<T>): Promise<T> => {
    const transport: HindsightTransport = deps.transport ?? ((url, init, maxBytes) => hindsightHttpTransport(url, init,
      { maxBytes, responseStatuses: Object.keys(input.responses ?? {}).map(Number) }));
    return requestJson({ ...input, endpoint, transport, resolveApiKey: deps.resolveApiKey });
  };
  return createClientMethods(request);
}

function createClientMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightClient {
  const methods: HindsightClient = {
    health: (context) => request({ path: "/health", context, schema: HindsightHealthWireSchema }),
    version: async (context) => {
      const result = await request({ path: "/version", context, schema: HindsightVersionWireSchema });
      return { apiVersion: result.api_version };
    },
    compatibility: (context) => request({ path: "/ext/taki-memory/version", context, schema: HindsightCompatibilityWireSchema }),
    createOrUpdateBank: async (bankId, context) => {
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(bankId)}`, init: {
        method: "PUT", body: JSON.stringify({}),
      }, context, schema: HindsightBankWireSchema });
      return { bankId: result.bank_id, name: result.name ?? null };
    },
    importTemplate: (input) => request({
      path: `/v1/default/banks/${encodeURIComponent(input.bankId)}/import?dry_run=${input.dryRun ? "true" : "false"}`,
      init: { method: "POST", body: JSON.stringify(HindsightBankTemplateManifestSchema.parse(input.template)) },
      context: input.context, schema: HindsightTemplateImportWireSchema,
    }),
    exportTemplate: (bankId, context) => request({ path: `/v1/default/banks/${encodeURIComponent(bankId)}/export`, context, schema: HindsightBankTemplateManifestSchema }),
    bankLlmHealth: async (bankId, context) => {
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(bankId)}/health/llm`, init: { method: "POST" }, context, schema: HindsightBankLlmHealthWireSchema });
      return { bankId: result.bank_id, operations: result.operations.map((operation) => ({ operation: operation.operation, ok: operation.ok, status: operation.status, latencyMs: operation.latency_ms ?? null })) };
    },
    operationStatus: async (bankId, operationId, context) => {
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}?include_payload=false`, context, schema: HindsightOperationStatusWireSchema });
      return { operationId: result.operation_id, status: result.status };
    },
    retainImport: async (input) => {
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(input.bankId)}/memories`, init: { method: "POST", body: JSON.stringify({ items: [{ content: input.content, document_id: input.documentId, context: input.context }], async: true, operation_id: input.operationId }) }, context: input.call, schema: HindsightRetainResponseSchema });
      if (!result.operation_id || result.operation_id !== input.operationId) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
      return { operationId: result.operation_id, itemsCount: result.items_count };
    },
    operationImportStatus: async (bankId, operationId, context) => {
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}?include_payload=false`, context, schema: HindsightDetailedOperationSchema });
      const metadata = result.result_metadata ?? {};
      const extractionErrorCount = readCount(metadata, "extraction_errors_count");
      return { operationId: result.operation_id, status: result.status, operationType: result.operation_type ?? null, resultMetadataHash: Object.keys(metadata).length ? canonicalPayloadHash(metadata) : null, derivedUnitCount: readCount(metadata, "unit_ids_count"), extractionErrorCount };
    },
    document: (bankId, documentId, context) => request({ path: `/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}`, context, schema: HindsightDocumentResponseSchema }),
    factPage: async (input) => {
      const query = new URLSearchParams({ document_id: input.documentId, limit: String(input.limit), offset: String(input.offset) });
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(input.bankId)}/memories/list?${query}`, context: input.context, schema: HindsightFactPageResponseSchema });
      return { items: result.items, total: result.total, limit: result.limit, offset: result.offset };
    },
  };
  return Object.assign(methods, createSnapshotMethods(request), createJournalMethods(request),
    createHindsightPendingMethods(request), createHindsightNativeResultMethods(request), createHindsightCurrentMethods(request),
    createHindsightRuntimeMethods(request), createHindsightApplicationMethods(request));
}

function createJournalMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): Pick<HindsightClient, "changesAfter"> {
  return { changesAfter: async (input) => {
    if (!Number.isSafeInteger(input.afterCursor) || input.afterCursor < 0 || !Number.isSafeInteger(input.limit)
      || input.limit < 1 || input.limit > 1000 || input.bankId.length < 1 || input.bankId.length > 256) {
      throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
    }
    const query = new URLSearchParams({ after_cursor: String(input.afterCursor), limit: String(input.limit) });
    return request({
      path: `/ext/taki-memory/banks/${encodeURIComponent(input.bankId)}/changes?${query}`,
      context: input.context, schema: { parse: (raw) => {
        const page = normalizeHindsightJournal(HindsightJournalWireSchema.parse(raw), input.bankId);
        if (page.predecessorCursor !== input.afterCursor) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
        return page;
      } },
    });
  } };
}

function createSnapshotMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): Pick<HindsightClient, "createLogicalSnapshot" | "logicalSnapshot" | "logicalSnapshotPage"> {
  return {
    createLogicalSnapshot: async (input) => normalizeSnapshotMetadata(await request({
      path: `/ext/taki-memory/banks/${encodeURIComponent(input.bankId)}/snapshots`,
      init: { method: "POST", body: JSON.stringify({ page_size: input.pageSize, ttl_seconds: input.ttlSeconds }) },
      context: input.context, schema: HindsightSnapshotMetadataWireSchema,
    })),
    logicalSnapshot: async (bankId, snapshotId, context) => normalizeSnapshotMetadata(await request({
      path: `/ext/taki-memory/banks/${encodeURIComponent(bankId)}/snapshots/${encodeURIComponent(snapshotId)}`,
      context, schema: HindsightSnapshotMetadataWireSchema,
    })),
    logicalSnapshotPage: async (input) => normalizeSnapshotPage(await request({
      path: `/ext/taki-memory/banks/${encodeURIComponent(input.bankId)}/snapshots/${encodeURIComponent(input.snapshotId)}/pages/${input.pageNumber}`,
      context: input.context, schema: HindsightSnapshotPageWireSchema,
    })),
  };
}

function readCount(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export interface HindsightRequestInput<T> {
  path: string;
  init?: RequestInit;
  context: HindsightCallContext;
  schema: { parse: (value: unknown) => T };
  responses?: Partial<Record<number, { parse: (value: unknown) => T }>>;
  maxResponseBytes?: number;
}

interface RequestJsonInput<T> extends HindsightRequestInput<T> {
  endpoint: URL;
  transport: HindsightTransport;
  resolveApiKey: () => string | null;
}

async function requestJson<T>(input: RequestJsonInput<T>): Promise<T> {
  if (input.context.signal?.aborted) throw hindsightError("HINDSIGHT_CANCELLED");
  if (!Number.isSafeInteger(input.context.timeoutMs) || input.context.timeoutMs <= 0
    || input.context.timeoutMs > MAX_TIMEOUT_MS) throw hindsightError("HINDSIGHT_TIMEOUT");
  const apiKey = input.resolveApiKey();
  if (!apiKey) throw hindsightError("HINDSIGHT_SECRET_UNAVAILABLE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.context.timeoutMs);
  const signal = composeSignal(input.context.signal, controller.signal);
  // Observe immediately: Node may resolve an unobserved composite lazily after both sources have aborted.
  // This also preserves first-cause semantics for injected transports that never subscribe to the signal.
  const firstAbort = { reason: signal.aborted ? signal.reason : undefined };
  const abortListener = addAbortListener(signal, () => { firstAbort.reason = signal.reason; });
  try {
    const response = await awaitTransport(signal, () => input.transport(new URL(input.path, input.endpoint), { ...input.init, signal, redirect: "manual", headers: { ...(input.init?.headers ?? {}), authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" } }, input.maxResponseBytes));
    requireActiveRequest(signal, controller.signal, firstAbort.reason);
    const expectedResponse = input.responses?.[response.status];
    if (expectedResponse) {
      try { return parseResponse(response, expectedResponse, input.maxResponseBytes); }
      catch (error) {
        // Only a matching endpoint envelope overrides transport/authentication classification.
        if (response.status === 403) throw hindsightError("HINDSIGHT_AUTHENTICATION_FAILED");
        if (response.status === 503) throw hindsightError("HINDSIGHT_UNREACHABLE");
        throw error;
      }
    }
    if (response.status >= 300 && response.status < 400) throw hindsightError("HINDSIGHT_UNREACHABLE");
    if (response.status === 401 || response.status === 403) throw hindsightError("HINDSIGHT_AUTHENTICATION_FAILED");
    if (response.status === 500 && input.path.includes("/snapshots")) throw hindsightError("HINDSIGHT_SNAPSHOT_INTEGRITY");
    if (response.status >= 500) throw hindsightError("HINDSIGHT_UNREACHABLE");
    if (response.status < 200 || response.status >= 300) throw mapHttpFailure(response.status, input.path);
    return parseResponse(response, input.schema, input.maxResponseBytes);
  } catch (error) {
    requireActiveRequest(signal, controller.signal, firstAbort.reason);
    if (error instanceof HindsightError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw hindsightError("HINDSIGHT_TIMEOUT");
    throw hindsightError("HINDSIGHT_UNREACHABLE");
  } finally {
    abortListener[Symbol.dispose]();
    clearTimeout(timer);
  }
}

function awaitTransport<T>(signal: AbortSignal, dispatch: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(hindsightError("HINDSIGHT_CANCELLED"));
  return new Promise((resolve, reject) => {
    const listener = addAbortListener(signal, () => {
      listener[Symbol.dispose](); reject(hindsightError("HINDSIGHT_CANCELLED"));
    });
    // Cancellation ends only our wait. Keep both handlers attached so a late
    // delegate outcome is consumed without parsing or acknowledging a write.
    try {
      void dispatch().then((value) => { listener[Symbol.dispose](); resolve(value); },
        (error: unknown) => { listener[Symbol.dispose](); reject(error); });
    } catch (error) { listener[Symbol.dispose](); reject(error); }
  });
}

function parseResponse<T>(response: HindsightTransportResponse, schema: { parse: (value: unknown) => T }, maxBytes = HINDSIGHT_DEFAULT_RESPONSE_BYTES): T {
  if (new TextEncoder().encode(response.body).byteLength > maxBytes) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  try { return schema.parse(response.body === "" ? null : JSON.parse(response.body)); }
  catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
}

function composeSignal(caller: AbortSignal | undefined, deadline: AbortSignal): AbortSignal {
  if (!caller) return deadline;
  return AbortSignal.any([caller, deadline]);
}

function requireActiveRequest(signal: AbortSignal, deadline: AbortSignal, firstReason: unknown): void {
  if (!signal.aborted) return;
  // Late settlement must not relabel an earlier deadline because the caller cancelled afterwards.
  // Caller-supplied reasons never enter an error or log.
  throw hindsightError(deadline.aborted && firstReason === deadline.reason ? "HINDSIGHT_TIMEOUT" : "HINDSIGHT_CANCELLED");
}

function mapHttpFailure(status: number, path: string): HindsightError {
  const snapshot = path.includes("/snapshots");
  const nativeRead = /^\/v1\/default\/banks\/[^/]+\/(?:memories\/recall|reflect)$/.test(path);
  const code: HindsightErrorCode = status === 408 ? "HINDSIGHT_TIMEOUT"
    : (snapshot || path.includes("/changes?")) && status === 409 ? "HINDSIGHT_CURSOR_RESET_REQUIRED"
      : snapshot && status === 410 ? "HINDSIGHT_SNAPSHOT_EXPIRED"
        : snapshot && status === 404 && path.includes("/pages/") ? "HINDSIGHT_SNAPSHOT_PAGE_MISSING"
          : snapshot && status === 404 ? "HINDSIGHT_SNAPSHOT_NOT_FOUND"
            : status === 409 && path.endsWith("/memories") ? "HINDSIGHT_OPERATION_IDENTITY_CONFLICT"
              : status === 409 ? "HINDSIGHT_TEMPLATE_CONFLICT"
              : (status === 422 || status === 400) && nativeRead ? "HINDSIGHT_RESPONSE_INVALID"
              : status === 422 || status === 400 ? "HINDSIGHT_TEMPLATE_INVALID" : "HINDSIGHT_RESPONSE_INVALID";
  return hindsightError(code);
}
