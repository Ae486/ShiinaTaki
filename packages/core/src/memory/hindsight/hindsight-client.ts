/**
 * INPUT:  an injected fetch transport, endpoint policy, and just-in-time API-key resolver
 * OUTPUT: authenticated, bounded Hindsight 0.9.0 endpoint operations with sanitized errors
 * POS:    core/memory/hindsight — OS-neutral REST seam; no retries, process, filesystem, or authority wiring
 */
import { type HindsightBankLlmHealthProjection, type HindsightErrorCode } from "@taki/shared";
import { normalizeHindsightEndpoint } from "./hindsight-endpoint-policy.ts";
import { HindsightError, hindsightError } from "./hindsight-errors.ts";
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

export interface HindsightTransportResponse {
  status: number;
  headers?: Headers;
  body: string;
}
export type HindsightTransport = (input: string | URL, init?: RequestInit) => Promise<HindsightTransportResponse>;
export interface HindsightCallContext {
  signal?: AbortSignal;
  timeoutMs: number;
  attemptId?: string;
}
export interface HindsightClient {
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
}

const MAX_RESPONSE_BYTES = 512 * 1024;

export function createHindsightClient(deps: {
  endpoint: string;
  resolveApiKey: () => string | null;
  transport?: HindsightTransport;
}): HindsightClient {
  const endpoint = normalizeHindsightEndpoint(deps.endpoint);
  const transport = deps.transport ?? defaultTransport;
  const request = <T>(input: RequestInput<T>): Promise<T> => requestJson({ ...input, endpoint, transport, resolveApiKey: deps.resolveApiKey });
  return {
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
  };
}

interface RequestInput<T> {
  path: string;
  init?: RequestInit;
  context: HindsightCallContext;
  schema: { parse: (value: unknown) => T };
}

interface RequestJsonInput<T> extends RequestInput<T> {
  endpoint: URL;
  transport: HindsightTransport;
  resolveApiKey: () => string | null;
}

async function requestJson<T>(input: RequestJsonInput<T>): Promise<T> {
  const apiKey = input.resolveApiKey();
  if (!apiKey) throw hindsightError("HINDSIGHT_SECRET_UNAVAILABLE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.context.timeoutMs);
  const signal = composeSignal(input.context.signal, controller.signal);
  try {
    const response = await input.transport(new URL(input.path, input.endpoint), { ...input.init, signal, redirect: "manual", headers: { ...(input.init?.headers ?? {}), authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" } });
    if (response.status >= 300 && response.status < 400) throw hindsightError("HINDSIGHT_UNREACHABLE");
    if (response.status === 401 || response.status === 403) throw hindsightError("HINDSIGHT_AUTHENTICATION_FAILED");
    if (response.status >= 500) throw hindsightError("HINDSIGHT_UNREACHABLE");
    if (response.status < 200 || response.status >= 300) throw mapHttpFailure(response.status);
    if (new TextEncoder().encode(response.body).byteLength > MAX_RESPONSE_BYTES) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
    let payload: unknown;
    try { payload = JSON.parse(response.body); } catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
    try { return input.schema.parse(payload); } catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
  } catch (error) {
    if (error instanceof HindsightError) throw error;
    if (input.context.signal?.aborted) throw hindsightError("HINDSIGHT_CANCELLED");
    if (error instanceof DOMException && error.name === "AbortError") throw hindsightError("HINDSIGHT_TIMEOUT");
    throw hindsightError("HINDSIGHT_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
}

function composeSignal(caller: AbortSignal | undefined, deadline: AbortSignal): AbortSignal {
  if (!caller) return deadline;
  return AbortSignal.any([caller, deadline]);
}

function mapHttpFailure(status: number): HindsightError {
  const code: HindsightErrorCode = status === 408 ? "HINDSIGHT_TIMEOUT" : status === 409 ? "HINDSIGHT_TEMPLATE_CONFLICT" : status === 422 || status === 400 ? "HINDSIGHT_TEMPLATE_INVALID" : "HINDSIGHT_RESPONSE_INVALID";
  return hindsightError(code);
}

async function defaultTransport(input: string | URL, init?: RequestInit): Promise<HindsightTransportResponse> {
  const response = await fetch(input, init);
  return { status: response.status, headers: response.headers, body: await response.text() };
}
