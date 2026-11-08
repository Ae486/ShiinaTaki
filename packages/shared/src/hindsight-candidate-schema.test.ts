import { describe, expect, it } from "vitest";
import { HindsightCandidateVerificationSchema, HindsightCandidateRestoredInventorySchema,
  HindsightCandidateArchiveManifestSchema, HindsightCandidateSchemaInventorySchema } from "./hindsight-candidate-schema.ts";

describe("candidate-only contract", () => {
  const base = { version: 1, candidateId: "11111111-1111-4111-8111-111111111111", inventoryHash: "a".repeat(64), identityHash: null,
    stage: "unverified", missing: ["physical_identity", "fresh_template_observation"] };
  it("requires explicit missing evidence and rejects readiness or incomplete verified projections", () => {
    expect(HindsightCandidateVerificationSchema.safeParse(base).success).toBe(true);
    for (const value of [{ ...base, missing: [] }, { ...base, stage: "baseline_verified" }, { ...base, deploymentReady: true },
      { ...base, identityHash: "b".repeat(64) }, { ...base, missing: ["restored_equality"] }]) {
      expect(HindsightCandidateVerificationSchema.safeParse(value).success).toBe(false);
    }
  });
  it("rejects repeated table/column identities instead of silently collapsing inventories", () => {
    const schema = { schema: "public", alembicRevision: "head", compatibilityBuild: "build", upstreamCommit: "upstream",
      tables: [{ name: "body", columns: [{ name: "id", typeName: "text" }] }] };
    expect(HindsightCandidateSchemaInventorySchema.safeParse({ ...schema, tables: [...schema.tables, ...schema.tables] }).success).toBe(false);
    const repeated = { rows: 0, size_bytes: 21, columns: [{ name: "id", type_name: "text" }, { name: "id", type_name: "text" }] };
    expect(HindsightCandidateArchiveManifestSchema.safeParse({ version: "2", schema: "public", created_at: "fixture", tables: { body: repeated } }).success).toBe(false);
    const row = { name: "body", rows: 0, rowsDigest: "a".repeat(64) };
    expect(HindsightCandidateRestoredInventorySchema.safeParse({ version: 1, candidateId: base.candidateId,
      archiveSha256: "b".repeat(64), schema, tables: [row, row] }).success).toBe(false);
  });
});
