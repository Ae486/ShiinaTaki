import { describe, expect, it } from "vitest";
import {
  HINDSIGHT_LOCAL_COVERAGE_ENCODING, HindsightLocalCoverageManifestSchema,
  HindsightLocalCoverageRecordSchema, HindsightLocalCoverageStatusSchema,
} from "./hindsight-local-coverage-schema.ts";

const hash = "a".repeat(64);
const source = { kind: "source" as const, key: '["source","bank","document",null]', bankId: "bank",
  objectId: "document", relatedId: null, revision: 1, payloadHash: hash,
  sourceHashes: { declaredContentHash: `sha256:${"b".repeat(64)}`, retainedTextSha256: hash, canonicalSourceHash: "c".repeat(64) } };
const bank = { kind: "bank", key: '["bank","bank","bank",null]', bankId: "bank", objectId: "bank", relatedId: null, revision: 1, payloadHash: hash };
const epoch = { kind: "epoch", key: '["epoch",null,"epoch",null]', bankId: null, objectId: "epoch", relatedId: null, revision: null, payloadHash: hash };
const manifest = { schemaVersion: 1, encoding: HINDSIGHT_LOCAL_COVERAGE_ENCODING, manifestId: "manifest",
  manifestVersion: 1, runId: "run", localEpochId: "epoch", capturedAt: "2026-08-22T00:00:00.000Z",
  bankIds: ["bank"], sourceCount: 1, sourceRevisionFence: hash, contentDigest: hash, records: [bank, epoch, source],
  b2EvidenceDigest: hash, b2MatchingRecordCount: 0, catchUp: [], manifestDigest: hash };

describe("current Local coverage schema", () => {
  it("keeps declared content identity and actual source/retained-text witnesses distinct", () => {
    expect(HindsightLocalCoverageManifestSchema.parse(manifest).records.find((record) => record.kind === "source")?.sourceHashes).toEqual(source.sourceHashes);
    expect(HindsightLocalCoverageRecordSchema.safeParse({ ...source, retainedText: "must not enter diagnostics" }).success).toBe(false);
  });

  it("refuses duplicate or unsorted logical identities and false source counts", () => {
    expect(HindsightLocalCoverageManifestSchema.safeParse({ ...manifest, records: [source, source], sourceCount: 2 }).success).toBe(false);
    expect(HindsightLocalCoverageManifestSchema.safeParse({ ...manifest, bankIds: ["z", "a"] }).success).toBe(false);
    expect(HindsightLocalCoverageManifestSchema.safeParse({ ...manifest, sourceCount: 2 }).success).toBe(false);
    expect(HindsightLocalCoverageManifestSchema.safeParse({ ...manifest, bankIds: ["other"] }).success).toBe(false);
    expect(HindsightLocalCoverageManifestSchema.safeParse({ ...manifest, localEpochId: "other" }).success).toBe(false);
    expect(HindsightLocalCoverageRecordSchema.safeParse({ ...source, key: '["source","bank","other",null]' }).success).toBe(false);
  });

  it("does not let a unit hash masquerade as a source witness", () => {
    expect(HindsightLocalCoverageRecordSchema.safeParse({ ...source, b2RecordPayloadHash: hash }).success).toBe(false);
    expect(HindsightLocalCoverageRecordSchema.safeParse({ ...source, kind: "unit" }).success).toBe(false);
    expect(HindsightLocalCoverageRecordSchema.safeParse({ ...source, sourceHashes: undefined }).success).toBe(false);
  });

  it("reports unavailable historical coverage counts as unknown", () => {
    expect(HindsightLocalCoverageStatusSchema.parse({ manifestId: null, manifestVersion: null, state: "historical",
      currentSourceCount: null, frozenSourceCount: null, catchUpCount: null })).toMatchObject({ currentSourceCount: null });
  });
});
