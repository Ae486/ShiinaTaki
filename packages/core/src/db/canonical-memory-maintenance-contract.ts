/**
 * INPUT:  captured Local authority, Bank scope, canonical identities, and maintenance intents
 * OUTPUT: narrow internal database contracts for Local maintenance and atomic ingestion
 * POS:    core/db — internal storage boundary; does not extend the foreground Memory Tool Contract
 */
import type {
  CanonicalMemoryRecord, CanonicalMemorySource, CanonicalMemoryUnit, TakiMemoryPolicyProjection,
} from "@taki/shared";

export interface CanonicalMaintenanceScope {
  epochId: string;
  bankId: string;
  /** The active Character. Global operations may use null; Character Banks must match exactly. */
  characterId: string | null;
}

export interface CanonicalMaintenanceTarget extends CanonicalMaintenanceScope {
  memoryId: string;
}

export interface CanonicalMaintenanceMutation extends CanonicalMaintenanceTarget {
  expectedRevision: number;
  requestId: string;
  now: string;
}

export type CanonicalMaintenancePolicyPatch = Partial<Pick<TakiMemoryPolicyProjection,
  "importance" | "disclosure" | "layerId" | "visibility" | "retention">>;

export type CanonicalMaintenanceResult = {
  outcome: "applied" | "unchanged";
  record: CanonicalMemoryRecord;
};

export interface CanonicalMaintenanceRetentionRow extends CanonicalMaintenanceTarget {
  revision: number;
  createdAt: string;
  updatedAt: string;
  policy: TakiMemoryPolicyProjection;
}

export interface CanonicalMaintenanceIngestInput extends CanonicalMaintenanceScope {
  requestId: string;
  now: string;
  source: CanonicalMemorySource;
  units: Array<{ unit: CanonicalMemoryUnit; policy: TakiMemoryPolicyProjection; searchTerms: string }>;
  duplicates: Array<{ memoryId: string; expectedRevision: number; importance: number }>;
}

export interface CanonicalMaintenanceIngestResult {
  documentId: string;
  sourceRevision: number;
  memories: Array<{ memoryId: string; revision: number }>;
  reinforced: Array<{ memoryId: string; revision: number }>;
}

export interface CanonicalMaintenanceCopyInput extends CanonicalMaintenanceMutation {
  destinationBankId: string;
  policy: Pick<TakiMemoryPolicyProjection, "layerId" | "visibility" | "retention">;
}

export interface CanonicalMaintenanceCopyResult {
  outcome: "applied";
  record: CanonicalMemoryRecord;
  original: CanonicalMemoryRecord;
  memoryMappings: Array<{ sourceMemoryId: string; memoryId: string }>;
  sourceMappings: Array<{ sourceDocumentId: string; documentId: string }>;
}

export interface CanonicalMemoryMaintenanceRepo {
  transaction<T>(operation: () => T): T;
  list(input: { epochId: string; characterId: string | null; layerIds?: string[]; includeInvalidated?: boolean }): CanonicalMemoryRecord[];
  /** Includes expired valid records in every Bank, without memory or source text. */
  listRetention(input: { epochId: string }): CanonicalMaintenanceRetentionRow[];
  record(input: CanonicalMaintenanceTarget): CanonicalMemoryRecord | undefined;
  source(input: CanonicalMaintenanceScope & { documentId: string }): CanonicalMemorySource | undefined;
  evidenceSources(input: CanonicalMaintenanceTarget): CanonicalMemorySource[];
  policyEdit(input: CanonicalMaintenanceMutation & { patch: CanonicalMaintenancePolicyPatch }): CanonicalMaintenanceResult;
  reinforce(input: CanonicalMaintenanceMutation & (
    { mode: "tidy" } | { mode: "duplicate-write"; importance: number }
  )): CanonicalMaintenanceResult;
  invalidate(input: CanonicalMaintenanceMutation & { reason: string | null }): CanonicalMaintenanceResult;
  restore(input: CanonicalMaintenanceMutation): CanonicalMaintenanceResult;
  ingest(input: CanonicalMaintenanceIngestInput): CanonicalMaintenanceIngestResult;
  ingestReceipt(input: CanonicalMaintenanceIngestInput): CanonicalMaintenanceIngestResult | undefined;
  /** Same-Bank copies reuse sources/support; cross-Bank copies remap the complete support graph. */
  copyToBank(input: CanonicalMaintenanceCopyInput): CanonicalMaintenanceCopyResult;
  hardDeleteRolling(input: CanonicalMaintenanceMutation): {
    outcome: "deleted"; bankId: string; memoryId: string; deletedRevision: number; deletedAt: string;
  };
}
