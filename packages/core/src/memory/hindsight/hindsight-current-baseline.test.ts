import { afterEach, describe, expect, it } from "vitest";
import { HindsightSnapshotRecordWireSchema, type HindsightCurrentTransferRequest } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { currentStateFixture, currentSnapshotFixture, CURRENT_LINEAGE, CURRENT_GENERATION, CURRENT_VERIFICATION } from "../../db/hindsight-current-fixtures.ts";
import { LOCAL_COVERAGE_NOW as now } from "../../db/hindsight-local-coverage-fixtures.ts";
import { prepareCurrentBaseline } from "./hindsight-current-baseline.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "./hindsight-snapshot-contracts.ts";
import { hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db); return currentStateFixture(db); }
function prepare(f: ReturnType<typeof fixture>, records = f.baselineRecords, supersede: HindsightCurrentTransferRequest["supersede"] = []) {
  const wire = currentSnapshotFixture(records, f.nativeBankId, 10);
  return prepareCurrentBaseline({ baseline: { metadata: normalizeSnapshotMetadata(wire.metadata), pages: wire.pages.map(normalizeSnapshotPage) },
    bankId: f.nativeBankId, providerLineage: CURRENT_LINEAGE, bankGeneration: CURRENT_GENERATION,
    scope: "global", templateRevision: "taki-bank-v1", templateDigest: f.templateDigest, now, supersede });
}
function extraDocument(f: ReturnType<typeof fixture>) {
  return HindsightSnapshotRecordWireSchema.parse({ object_kind: "document", object_id: "unknown-native-document", object_revision: 7,
    payload: { bank_id: f.nativeBankId, document_id: "unknown-native-document", content_hash: null, tags: [], metadata: {},
      observation_scopes: null, created_at: now, updated_at: now } });
}

describe("D78 exact B3 baseline admission", () => {
  it("preserves authored B3 model content with a witness over the entire native payload", () => {
    const f = fixture(); const changed = structuredClone(f.baselineRecords);
    const model = changed.find((record) => record.object_kind === "mental_model")!;
    model.object_revision++; model.payload.content = "Authored native content that is not owned by the template.";
    model.payload.reflect_response = { custom: { numeric: 1, text: "1" } };
    const prepared = prepare(f, changed);
    expect(prepared.preserve.find((record) => record.object_kind === "mental_model")).toMatchObject({
      object_id: model.object_id, object_revision: model.object_revision, payload_hash: hindsightCurrentStateHash(model.payload),
    });
    expect(prepared.preserve).not.toEqual(prepare(f).preserve);
  });

  it("refuses unaccounted native data even when its Bank and B3 controls are valid", () => {
    const f = fixture();
    expect(() => prepare(f, [...f.baselineRecords, extraDocument(f)])).toThrow("HINDSIGHT_CURRENT_TARGET_CONFLICT");
  });

  it.each(["model-definition", "directive-policy", "bank-config", "duplicate-model"] as const)("refuses %s drift", (kind) => {
    const f = fixture(); const changed = structuredClone(f.baselineRecords);
    const model = changed.find((record) => record.object_kind === "mental_model")!;
    if (kind === "model-definition") model.payload.source_query = "An unverified definition.";
    if (kind === "directive-policy") changed.find((record) => record.object_kind === "directive")!.payload.is_active = false;
    if (kind === "bank-config") changed.find((record) => record.object_kind === "bank")!.payload.config = {};
    if (kind === "duplicate-model") changed.push(structuredClone(model));
    expect(() => prepare(f, changed)).toThrow();
  });

  it("requires exact object versions and full coverage for an explicitly supplied supersession set", () => {
    const f = fixture(); const document = extraDocument(f); const records = [...f.baselineRecords, document];
    const supersede: HindsightCurrentTransferRequest["supersede"] = [{ object_kind: "document", object_id: document.object_id,
      object_revision: document.object_revision, payload_hash: hindsightCurrentStateHash(document.payload),
      ownership: { receipt_kind: "current_state_transfer", operation_id: CURRENT_VERIFICATION,
        request_hash: "a".repeat(64), result_hash: "b".repeat(64) } }];
    expect(prepare(f, records, supersede).preserve).toHaveLength(2);
    const stale = structuredClone(supersede); stale[0]!.object_revision++;
    expect(() => prepare(f, records, stale)).toThrow("HINDSIGHT_CURRENT_TARGET_CONFLICT");
    const extra = structuredClone(document); extra.object_id = "second-native-document"; extra.payload.document_id = extra.object_id;
    expect(() => prepare(f, [...records, extra], supersede)).toThrow("HINDSIGHT_CURRENT_TARGET_CONFLICT");
  });
});
