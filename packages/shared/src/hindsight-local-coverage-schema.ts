/**
 * INPUT:  frozen current Local identities, revisions, payload witnesses, and bounded comparison results
 * OUTPUT: versioned coverage manifests and privacy-safe B4 completeness diagnostics
 * POS:    shared contract — current coverage is independent of immutable historical B2 import records
 */
import { z } from "zod";

const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime({ offset: true });
// Refuse oversized captures atomically; never publish a silently truncated completeness claim.
export const HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS = 100_000;
export const HINDSIGHT_LOCAL_COVERAGE_ENCODING = "taki-local-coverage/canonical-json-v1";

export const HindsightLocalCoverageKindSchema = z.enum([
  "epoch", "bank", "source", "unit", "policy", "source-provenance", "lineage", "derived", "block",
]);
export type HindsightLocalCoverageKind = z.infer<typeof HindsightLocalCoverageKindSchema>;

const Identity = {
  kind: HindsightLocalCoverageKindSchema,
  key: z.string().min(1).max(8192),
  bankId: Id.nullable(),
  objectId: Id,
  relatedId: Id.nullable(),
};

export const HindsightLocalCoverageRecordSchema = z.strictObject({
  ...Identity,
  revision: z.int().min(1).nullable(),
  payloadHash: Hash,
  sourceHashes: z.strictObject({
    declaredContentHash: z.string().max(256).nullable(),
    retainedTextSha256: Hash.nullable(),
    canonicalSourceHash: Hash,
  }).optional(),
  b2RecordPayloadHash: Hash.optional(),
}).superRefine((value, context) => {
  if (value.key !== JSON.stringify([value.kind, value.bankId, value.objectId, value.relatedId])) {
    context.addIssue({ code: "custom", message: "logical key must match its complete identity" });
  }
  if ((value.kind === "source") !== (value.sourceHashes !== undefined)) {
    context.addIssue({ code: "custom", message: "only source records carry source hash witnesses" });
  }
  if (value.b2RecordPayloadHash !== undefined && value.kind !== "unit") {
    context.addIssue({ code: "custom", message: "B2 record hashes belong to complete unit records" });
  }
});
export type HindsightLocalCoverageRecord = z.infer<typeof HindsightLocalCoverageRecordSchema>;

export const HindsightLocalCoverageCatchUpSchema = z.strictObject({
  ...Identity,
  reason: z.enum(["b2-new", "b2-changed", "b2-missing", "b2-unproven"]),
  b2SourceId: Id.nullable(),
  previousRevision: z.int().min(1).nullable(),
  currentRevision: z.int().min(1).nullable(),
  previousHash: Hash.nullable(),
  currentHash: Hash.nullable(),
});
export type HindsightLocalCoverageCatchUp = z.infer<typeof HindsightLocalCoverageCatchUpSchema>;

export const HindsightLocalCoverageManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  encoding: z.literal(HINDSIGHT_LOCAL_COVERAGE_ENCODING),
  manifestId: Id,
  manifestVersion: z.int().min(1),
  runId: Id,
  localEpochId: Id,
  capturedAt: Timestamp,
  bankIds: z.array(Id).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  sourceCount: z.int().min(0),
  sourceRevisionFence: Hash,
  contentDigest: Hash,
  records: z.array(HindsightLocalCoverageRecordSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  b2EvidenceDigest: Hash,
  b2MatchingRecordCount: z.int().min(0),
  catchUp: z.array(HindsightLocalCoverageCatchUpSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  manifestDigest: Hash,
}).superRefine((value, context) => {
  const keys = value.records.map((record) => record.key);
  if (!strictlySorted(keys) || !strictlySorted(value.bankIds)) {
    context.addIssue({ code: "custom", message: "coverage identities must be unique and sorted" });
  }
  if (value.sourceCount !== value.records.filter((record) => record.kind === "source").length) {
    context.addIssue({ code: "custom", message: "source count must match the frozen source set" });
  }
  const banks = value.records.filter((record) => record.kind === "bank").map((record) => record.objectId).sort();
  if (JSON.stringify(banks) !== JSON.stringify(value.bankIds)) {
    context.addIssue({ code: "custom", message: "Bank identities must match the frozen Bank set" });
  }
  const epochs = value.records.filter((record) => record.kind === "epoch");
  if (epochs.length !== 1 || epochs[0]?.objectId !== value.localEpochId) {
    context.addIssue({ code: "custom", message: "coverage must include its exact Local epoch" });
  }
  const bankSet = new Set(value.bankIds);
  if (value.records.some((record) => record.bankId !== null && !bankSet.has(record.bankId))) {
    context.addIssue({ code: "custom", message: "record belongs to an uncaptured Bank" });
  }
});
export type HindsightLocalCoverageManifest = z.infer<typeof HindsightLocalCoverageManifestSchema>;

export const HindsightLocalCoverageDifferenceSchema = z.strictObject({
  ...Identity,
  change: z.enum(["added", "changed", "missing"]),
  previousRevision: z.int().min(1).nullable(),
  currentRevision: z.int().min(1).nullable(),
  previousHash: Hash.nullable(),
  currentHash: Hash.nullable(),
});
export type HindsightLocalCoverageDifference = z.infer<typeof HindsightLocalCoverageDifferenceSchema>;

export const HindsightLocalCoverageComparisonSchema = z.strictObject({
  manifestId: Id,
  currentEpochId: Id,
  matches: z.boolean(),
  currentSourceCount: z.int().min(0),
  currentContentDigest: Hash,
  currentSourceRevisionFence: Hash,
  differences: z.array(HindsightLocalCoverageDifferenceSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
});
export type HindsightLocalCoverageComparison = z.infer<typeof HindsightLocalCoverageComparisonSchema>;

export const HindsightLocalCoverageStatusSchema = z.strictObject({
  manifestId: Id.nullable(),
  manifestVersion: z.int().min(1).nullable(),
  state: z.enum(["missing", "current", "stale", "historical"]),
  currentSourceCount: z.int().min(0).nullable(),
  frozenSourceCount: z.int().min(0).nullable(),
  catchUpCount: z.int().min(0).nullable(),
});
export type HindsightLocalCoverageStatus = z.infer<typeof HindsightLocalCoverageStatusSchema>;

function strictlySorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || String(values[index - 1]) < value);
}
