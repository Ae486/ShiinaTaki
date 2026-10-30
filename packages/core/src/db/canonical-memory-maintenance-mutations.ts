/**
 * INPUT:  scoped policy, reinforcement, and lifecycle intents with captured revisions
 * OUTPUT: atomic revisioned policy/proof changes with historical idempotency and consistent FTS
 * POS:    core/db — Local maintenance writer; lifecycle operations reuse the canonical repository
 */
import {
  HindsightCurrentCanonicalRecordSchema, TakiMemoryPolicyProjectionSchema,
  type CanonicalMemoryRecord,
} from "@taki/shared";
import { z } from "zod";
import type { SearchTokenizer } from "../memory/search-tokenizer.ts";
import type {
  CanonicalMaintenanceMutation, CanonicalMaintenanceResult, CanonicalMemoryMaintenanceRepo,
} from "./canonical-memory-maintenance-contract.ts";
import {
  canonicalMaintenanceRequestHash, decodeCanonicalMaintenanceMutation, encodeCanonicalMaintenanceMutation,
  runCanonicalMaintenance, validateCanonicalMaintenanceMutation,
} from "./canonical-memory-maintenance-journal.ts";
import { requireExpectedCanonicalRecord } from "./canonical-memory-maintenance-query.ts";
import { canonicalControlledLayerTags, readCanonicalRecord, replaceCanonicalFts,
  updateCanonicalRecord } from "./canonical-memory-maintenance-records.ts";
import { canonicalMemoryAtomic, readCanonicalSnapshot, saveCanonicalSnapshot } from "./canonical-memory-maintenance-storage.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import type { Database } from "./sqlite.ts";

type ReinforceInput = Parameters<CanonicalMemoryMaintenanceRepo["reinforce"]>[0];
type PolicyInput = Parameters<CanonicalMemoryMaintenanceRepo["policyEdit"]>[0];
export interface CanonicalMaintenanceWriter { db: Database; tokenizer: SearchTokenizer; }
const PolicyPatch = TakiMemoryPolicyProjectionSchema.pick({ importance: true, disclosure: true,
  layerId: true, visibility: true, retention: true }).partial().refine((value) => Object.keys(value).length > 0);
const Importance = z.int().min(1).max(10);
const Reason = z.string().max(512).nullable();

export function createCanonicalMaintenanceMutations(writer: CanonicalMaintenanceWriter): Pick<CanonicalMemoryMaintenanceRepo,
  "policyEdit" | "reinforce" | "invalidate" | "restore"> {
  return {
    policyEdit: (input) => policyEdit(writer, input),
    reinforce: (input) => reinforce(writer, input),
    invalidate: (input) => lifecycle(writer, input, "invalidate"),
    restore: (input) => lifecycle(writer, input, "restore"),
  };
}

function policyEdit(writer: CanonicalMaintenanceWriter, input: PolicyInput): CanonicalMaintenanceResult {
  validateCanonicalMaintenanceMutation(writer.db, input);
  const patch = PolicyPatch.safeParse(input.patch);
  if (!patch.success) throw new Error("MEMORY_INVALID_REQUEST");
  return runCanonicalMaintenance(writer.db, input, { kind: "policy-edit",
    encode: encodeCanonicalMaintenanceMutation,
    decode: (value) => decodeCanonicalMaintenanceMutation(writer.db, input, value),
    apply() {
      const current = requireExpectedCanonicalRecord(writer.db, input);
      const policy = { ...current.policy, ...patch.data, updatedAt: input.now };
      const unit = { ...current.unit, revision: current.unit.revision + 1, updatedAt: input.now,
        tags: patch.data.layerId === undefined ? current.unit.tags : canonicalControlledLayerTags(current.unit.tags, policy.layerId) };
      return commitCanonicalMaintenanceRecord(writer, input, HindsightCurrentCanonicalRecordSchema.parse({ ...current, unit, policy }));
    },
  });
}

function reinforce(writer: CanonicalMaintenanceWriter, input: ReinforceInput): CanonicalMaintenanceResult {
  validateCanonicalMaintenanceMutation(writer.db, input);
  if (input.mode !== "tidy" && input.mode !== "duplicate-write"
    || input.mode === "tidy" && "importance" in input
    || input.mode === "duplicate-write" && !Importance.safeParse(input.importance).success) {
    throw new Error("MEMORY_INVALID_REQUEST");
  }
  return runCanonicalMaintenance(writer.db, input, { kind: "reinforce",
    apply: () => applyCanonicalReinforcement(writer, input), encode: encodeCanonicalMaintenanceMutation,
    decode: (value) => decodeCanonicalMaintenanceMutation(writer.db, input, value) });
}

export function applyCanonicalReinforcement(writer: CanonicalMaintenanceWriter, input: ReinforceInput): CanonicalMaintenanceResult {
  const current = requireExpectedCanonicalRecord(writer.db, input);
  if (current.unit.state !== "valid") throw new Error("MEMORY_INVALID_REQUEST: reinforce requires a valid memory");
  // T5's tidy refresh only proves continued relevance. A duplicate write also supplies an incoming
  // importance grade; it may raise the old grade, and can never demote an explicit high grade.
  const importance = input.mode === "tidy" ? current.policy.importance : Math.max(current.policy.importance, input.importance);
  const record = HindsightCurrentCanonicalRecordSchema.parse({ ...current,
    unit: { ...current.unit, revision: current.unit.revision + 1, proofCount: current.unit.proofCount + 1, updatedAt: input.now },
    policy: { ...current.policy, importance, updatedAt: importance === current.policy.importance ? current.policy.updatedAt : input.now } });
  return commitCanonicalMaintenanceRecord(writer, input, record);
}

export function commitCanonicalMaintenanceRecord(writer: CanonicalMaintenanceWriter, input: CanonicalMaintenanceMutation,
  record: CanonicalMemoryRecord): CanonicalMaintenanceResult {
  updateCanonicalRecord(writer.db, { record, expectedRevision: input.expectedRevision });
  replaceCanonicalFts(writer.db, record.unit, canonicalMaintenanceSearchTerms(writer.tokenizer, record));
  saveCanonicalSnapshot(writer.db, record, input.now);
  return { outcome: "applied", record };
}

export function canonicalMaintenanceSearchTerms(tokenizer: SearchTokenizer, record: CanonicalMemoryRecord): string {
  return tokenizer.tokenize([record.unit.text, record.unit.context, record.policy.disclosure]
    .filter((value): value is string => value !== null).join(" ")).join(" ");
}

function lifecycle(writer: CanonicalMaintenanceWriter, input: CanonicalMaintenanceMutation & { reason?: string | null },
  operation: "invalidate" | "restore"): CanonicalMaintenanceResult {
  return canonicalMemoryAtomic(writer.db, () => {
    validateCanonicalMaintenanceMutation(writer.db, input);
    if (operation === "invalidate" && !Reason.safeParse(input.reason).success) throw new Error("MEMORY_INVALID_REQUEST");
    const current = readCanonicalRecord(writer.db, input);
    if (current && current.unit.revision === input.expectedRevision) ensureCanonicalMaintenanceSnapshot(writer.db, current, input.now);
    const request = { ...input, requestHash: canonicalMaintenanceRequestHash(operation, input),
      searchTerms: current ? canonicalMaintenanceSearchTerms(writer.tokenizer, current) : "" };
    const records = createCanonicalMemoryRepo(writer.db);
    const result = operation === "invalidate" ? records.invalidate({ ...request, reason: input.reason ?? null }) : records.restore(request);
    validateCanonicalMaintenanceMutation(writer.db, input);
    return result;
  });
}

export function ensureCanonicalMaintenanceSnapshot(db: Database, record: CanonicalMemoryRecord, now: string): void {
  const unit = record.unit;
  if (!readCanonicalSnapshot(db, { epochId: unit.authorityEpochId, bankId: unit.bankId,
    memoryId: unit.memoryId, revision: unit.revision })) saveCanonicalSnapshot(db, record, now);
}
