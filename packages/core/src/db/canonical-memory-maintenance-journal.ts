/**
 * INPUT:  scoped Local maintenance intents and operation-specific historical codecs
 * OUTPUT: payload-bound idempotent operations and compact revision-based receipt replay
 * POS:    core/db — one canonical receipt namespace; replay never repeats a durable mutation
 */
import { z } from "zod";
import type {
  CanonicalMaintenanceMutation, CanonicalMaintenanceResult, CanonicalMaintenanceScope, CanonicalMaintenanceTarget,
} from "./canonical-memory-maintenance-contract.ts";
import { stableRequestHash } from "./canonical-memory-repo.ts";
import {
  assertCanonicalMaintenanceScope, canonicalMemoryAtomic, readCanonicalReceipt,
  readCanonicalSnapshot, saveCanonicalReceipt,
} from "./canonical-memory-maintenance-storage.ts";
import type { Database } from "./sqlite.ts";

const Id = z.string().min(1).max(256);
const Request = z.strictObject({ requestId: Id, now: z.iso.datetime({ offset: true }) });
const Target = z.strictObject({ memoryId: Id, expectedRevision: z.int().min(1) });
const Receipt = z.strictObject({ version: z.literal(1), kind: Id, result: z.unknown() });
const MutationReceipt = z.strictObject({ outcome: z.enum(["applied", "unchanged"]),
  bankId: Id, memoryId: Id, revision: z.int().min(1) });

type RequestScope = CanonicalMaintenanceScope & { requestId: string; now: string };
interface MaintenanceOperation<T> {
  kind: string;
  additionalScopes?: CanonicalMaintenanceScope[];
  apply(): T;
  encode(result: T): unknown;
  decode(value: unknown): T;
}

export function validateCanonicalMaintenanceRequest(db: Database, input: RequestScope): void {
  assertCanonicalMaintenanceScope(db, input);
  if (!Request.safeParse({ requestId: input.requestId, now: input.now }).success) {
    throw new Error("MEMORY_INVALID_REQUEST");
  }
}

export function validateCanonicalMaintenanceMutation(db: Database, input: CanonicalMaintenanceMutation): void {
  validateCanonicalMaintenanceRequest(db, input);
  if (!Target.safeParse({ memoryId: input.memoryId, expectedRevision: input.expectedRevision }).success) {
    throw new Error("MEMORY_INVALID_REQUEST");
  }
}

export function canonicalMaintenanceRequestHash(kind: string, input: RequestScope): string {
  // Wall time is execution context. A lost acknowledgement must be replayable at a later time,
  // while every semantic field (including Character scope and CAS revision) remains bound.
  const intent = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "now" && key !== "requestId"));
  return stableRequestHash(["canonical-local-maintenance.v1", kind, intent]);
}

export function runCanonicalMaintenance<T>(db: Database, input: RequestScope, operation: MaintenanceOperation<T>): T {
  return canonicalMemoryAtomic(db, () => {
    const previous = readCanonicalMaintenanceReceipt(db, input, operation);
    if (previous !== undefined) return previous;
    const result = operation.apply();
    saveCanonicalReceipt(db, { epochId: input.epochId, requestId: input.requestId, operation: "maintenance",
      requestHash: canonicalMaintenanceRequestHash(operation.kind, input),
      result: { version: 1, kind: operation.kind, result: operation.encode(result) }, createdAt: input.now });
    validateCanonicalMaintenanceRequest(db, input);
    for (const scope of operation.additionalScopes ?? []) assertCanonicalMaintenanceScope(db, scope);
    return result;
  });
}

export function readCanonicalMaintenanceReceipt<T>(db: Database, input: RequestScope,
  operation: Pick<MaintenanceOperation<T>, "kind" | "decode" | "additionalScopes">): T | undefined {
  validateCanonicalMaintenanceRequest(db, input);
  for (const scope of operation.additionalScopes ?? []) assertCanonicalMaintenanceScope(db, scope);
  const previous = readCanonicalReceipt(db, input.epochId, input.requestId);
  if (!previous) return undefined;
  if (previous.operation !== "maintenance" || previous.requestHash !== canonicalMaintenanceRequestHash(operation.kind, input)) {
    throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  }
  const stored = Receipt.parse(previous.result);
  if (stored.kind !== operation.kind) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  return operation.decode(stored.result);
}

export function encodeCanonicalMaintenanceMutation(result: CanonicalMaintenanceResult) {
  return { outcome: result.outcome, bankId: result.record.unit.bankId,
    memoryId: result.record.unit.memoryId, revision: result.record.unit.revision };
}

export function decodeCanonicalMaintenanceMutation(db: Database, target: Pick<CanonicalMaintenanceTarget, "epochId" | "bankId" | "memoryId">,
  value: unknown): CanonicalMaintenanceResult {
  const receipt = MutationReceipt.parse(value);
  if (receipt.bankId !== target.bankId || receipt.memoryId !== target.memoryId) {
    throw new Error("MEMORY_INTEGRITY_ERROR: maintenance receipt identity mismatch");
  }
  const record = readCanonicalSnapshot(db, { epochId: target.epochId, bankId: receipt.bankId,
    memoryId: receipt.memoryId, revision: receipt.revision });
  if (!record) throw new Error("MEMORY_INTEGRITY_ERROR: maintenance snapshot missing");
  return { outcome: receipt.outcome, record };
}
