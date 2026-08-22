/**
 * INPUT:  normalized B2 source content, deterministic identities, injected Hindsight data-plane client, and ledger
 * OUTPUT: resumable source import with terminal operation and one-to-many fact mapping evidence
 * POS:    core/memory/hindsight — operator migration path only; never selects authority or calls filesystem/LLM
 */
import { createHash } from "node:crypto";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import { HindsightError } from "./hindsight-errors.ts";
import type { HindsightImportLedgerRepo } from "./hindsight-import-ledger-repo.ts";
import type { HindsightCutoverLease } from "../../db/hindsight-cutover-run-repo.ts";

export interface HindsightImportSource { lease: HindsightCutoverLease; sourceId: string; bankId: string; documentId: string; operationIdentity: string; remoteOperationId: string; content: string; contentIdentity: string; context: string | null; zeroFactAllowed: boolean }
export interface HindsightImportOptions { client: HindsightClient; ledger: HindsightImportLedgerRepo; now?: () => string; deadlineMs?: number; pollIntervalMs?: number; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal }

export async function importHindsightSource(source: HindsightImportSource, options: HindsightImportOptions): Promise<ReturnType<HindsightImportLedgerRepo["read"]>> {
  const now = options.now ?? (() => new Date().toISOString());
  const deadline = Date.now() + (options.deadlineMs ?? 60_000);
  const ledger = options.ledger;
  const providerContentHash = createHash("sha256").update(source.content).digest("hex");
  const existing = ledger.ensureOperation({ lease: source.lease, sourceId: source.sourceId, bankId: source.bankId, documentId: source.documentId, operationIdentity: source.operationIdentity, remoteOperationId: source.remoteOperationId, contentIdentity: source.contentIdentity, providerContentHash, zeroFactAllowed: source.zeroFactAllowed, now: now() });
  if (existing.status === "mapped" || existing.status === "excluded") return existing;
  ledger.beginAttempt({ lease: source.lease, sourceId: source.sourceId, now: now() });
  await submitWithLostAckRetry(source, options, { deadline, now });
  const outcome = await awaitOperation(source, options, deadline);
  if (outcome.status !== "completed") {
    ledger.markOperation({ lease: source.lease, sourceId: source.sourceId, status: outcome.status === "cancelled" || outcome.status === "not_found" ? "cancelled" : "failed", resultHash: outcome.resultMetadataHash, derivedUnitCount: outcome.derivedUnitCount, extractionErrorCount: outcome.extractionErrorCount, diagnosticCode: `HINDSIGHT_OPERATION_${outcome.status.toUpperCase()}`, now: now() });
    throw new Error(`HINDSIGHT_OPERATION_${outcome.status.toUpperCase()}`);
  }
  if (outcome.resultMetadataHash === null || outcome.derivedUnitCount === null || (outcome.extractionErrorCount ?? 0) > 0) {
    ledger.markOperation({ lease: source.lease, sourceId: source.sourceId, status: "failed", resultHash: outcome.resultMetadataHash, derivedUnitCount: outcome.derivedUnitCount, extractionErrorCount: outcome.extractionErrorCount, diagnosticCode: "HINDSIGHT_DERIVED_INCOMPLETE", now: now() });
    throw new Error("HINDSIGHT_DERIVED_INCOMPLETE");
  }
  ledger.markOperation({ lease: source.lease, sourceId: source.sourceId, status: "completed",
    resultHash: outcome.resultMetadataHash, derivedUnitCount: outcome.derivedUnitCount,
    extractionErrorCount: outcome.extractionErrorCount, now: now() });
  const mappings = await resolveFacts({ source, providerContentHash }, options, deadline);
  if (mappings.length === 0 && (!source.zeroFactAllowed || outcome.derivedUnitCount !== 0)) throw new Error("HINDSIGHT_ZERO_FACT_NOT_ALLOWED");
  if (mappings.length !== outcome.derivedUnitCount) throw new Error("HINDSIGHT_MAPPING_COUNT_MISMATCH");
  return ledger.setMappings({ lease: source.lease, sourceId: source.sourceId, mappings, now: now() });
}

async function submitWithLostAckRetry(source: HindsightImportSource, options: HindsightImportOptions, timing: { deadline: number; now: () => string }): Promise<void> {
  let attempts = 0;
  while (attempts < 2) {
    attempts += 1;
    try {
      const call = context(options, timing.deadline);
      if (!options.client.retainImport) throw new Error("HINDSIGHT_IMPORT_CLIENT_UNAVAILABLE");
      await options.client.retainImport({ bankId: source.bankId, content: source.content, documentId: source.documentId, operationId: source.remoteOperationId, context: source.context, call });
      options.ledger.markOperation({ lease: source.lease, sourceId: source.sourceId, status: "submitted", now: timing.now() });
      return;
    } catch (error) {
      if (!(error instanceof HindsightError) || !error.retryable || attempts >= 2) {
        options.ledger.markOperation({ lease: source.lease, sourceId: source.sourceId, status: "failed", diagnosticCode: "HINDSIGHT_RETAIN_FAILED", now: timing.now() });
        throw error;
      }
    }
  }
}

type ImportOperationStatus = { operationId: string; status: "pending" | "processing" | "completed" | "failed" | "cancelled" | "not_found"; resultMetadataHash: string | null; derivedUnitCount: number | null; extractionErrorCount: number | null };
async function awaitOperation(source: HindsightImportSource, options: HindsightImportOptions, deadline: number): Promise<ImportOperationStatus> {
  for (;;) {
    if (!options.client.operationImportStatus) throw new Error("HINDSIGHT_IMPORT_CLIENT_UNAVAILABLE");
    const result = await options.client.operationImportStatus(source.bankId, source.remoteOperationId, context(options, deadline));
    if (result.operationId !== source.remoteOperationId) throw new Error("HINDSIGHT_OPERATION_IDENTITY_CONFLICT");
    const projected: ImportOperationStatus = { operationId: result.operationId, status: result.status, resultMetadataHash: result.resultMetadataHash, derivedUnitCount: result.derivedUnitCount, extractionErrorCount: result.extractionErrorCount };
    if (result.status === "completed" || result.status === "failed" || result.status === "cancelled" || result.status === "not_found") return projected;
    options.ledger.markOperation({ lease: source.lease, sourceId: source.sourceId, status: result.status, resultHash: result.resultMetadataHash, derivedUnitCount: result.derivedUnitCount, extractionErrorCount: result.extractionErrorCount, now: (options.now ?? (() => new Date().toISOString()))() });
    await delay(options, deadline);
  }
}

async function resolveFacts(identity: { source: HindsightImportSource; providerContentHash: string }, options: HindsightImportOptions, deadline: number): Promise<Array<{ factOrdinal: number; factId: string; revision: number; payloadHash: string }>> {
  const { source, providerContentHash } = identity;
  if (!options.client.document || !options.client.factPage) throw new Error("HINDSIGHT_IMPORT_CLIENT_UNAVAILABLE");
  const document = await options.client.document(source.bankId, source.documentId, context(options, deadline));
  if (document.bank_id !== source.bankId || document.id !== source.documentId) throw new Error("HINDSIGHT_DOCUMENT_MISMATCH");
  if (document.content_hash && normalizeHash(document.content_hash) !== providerContentHash) throw new Error("HINDSIGHT_CONTENT_HASH_CONFLICT");
  const mappings: Array<{ factOrdinal: number; factId: string; revision: number; payloadHash: string }> = [];
  let offset = 0;
  for (;;) {
    const page = await options.client.factPage({ bankId: source.bankId, documentId: source.documentId, limit: 100, offset, context: context(options, deadline) });
    if (page.offset !== offset || page.limit < 1 || page.total < page.items.length + offset) throw new Error("HINDSIGHT_FACT_PAGE_INVALID");
    for (const item of page.items) {
      const factId = typeof item.id === "string" ? item.id : null;
      const documentId = item.document_id === null || item.document_id === undefined ? null : String(item.document_id);
      const revision = typeof item.revision === "number" && Number.isInteger(item.revision) && item.revision >= 1 ? item.revision : null;
      if (!factId || documentId !== source.documentId || revision === null) throw new Error("HINDSIGHT_FACT_MAPPING_INVALID");
      mappings.push({ factOrdinal: mappings.length, factId, revision, payloadHash: canonicalPayloadHash(item) });
    }
    offset += page.items.length;
    if (offset >= page.total) return mappings;
    if (page.items.length === 0) throw new Error("HINDSIGHT_FACT_PAGE_STALLED");
  }
}

function normalizeHash(value: string): string { return value.startsWith("sha256:") ? value.slice(7) : value; }
function context(options: HindsightImportOptions, deadline: number): HindsightCallContext {
  if (options.signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
  const timeoutMs = Math.max(1, deadline - Date.now());
  if (timeoutMs <= 1) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  return { timeoutMs, signal: options.signal };
}
async function delay(options: HindsightImportOptions, deadline: number): Promise<void> {
  if (Date.now() >= deadline) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  await (options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(Math.min(options.pollIntervalMs ?? 25, Math.max(1, deadline - Date.now())));
}
