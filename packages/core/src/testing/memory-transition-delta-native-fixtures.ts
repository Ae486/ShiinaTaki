/**
 * INPUT: complete prepared delta descriptors and a synthetic prior native inventory
 * OUTPUT: deterministic native identities/revisions for real Core driver journey tests
 * POS: core/testing — models wire shapes only, never native maintenance acceptance
 */
import { TakiApplicationNativePayloadSchema, type MemoryTransitionPreparation, type HindsightTransitionDeltaResult } from "@taki/shared";
import { applicationTestNative, type ApplicationNativeFixture } from "./hindsight-application-fixtures.ts";

type Prepared = MemoryTransitionPreparation;
type Scope = NonNullable<Parameters<typeof applicationTestNative>[0]["scope"]>;
export function applyFixtureNativeDelta(prepared: Prepared, scope: Scope, native: ApplicationNativeFixture[]) {
  let cursor = Math.max(...native.map((node) => node.head.version?.native_cursor ?? node.head.tombstone?.native_cursor ?? 0));
  const targets = new Map(prepared.request.native.map((row) => [JSON.stringify([row.source.source_kind, row.source.source_id]),
    row.target?.object_id ?? `delta-${row.source.source_kind}-${row.source.source_id}`]));
  const target = (kind: string, id: string) => targets.get(JSON.stringify([kind, id])) ?? id;
  const mappings: HindsightTransitionDeltaResult["mappings"] = [];
  for (const descriptor of prepared.request.native) {
    const kind = descriptor.source.source_kind; const id = target(kind, descriptor.source.source_id);
    const previous = native.find((node) => node.head.object_kind === kind && node.head.object_id === id);
    if (descriptor.disposition === "reuse") { mappings.push({ source: descriptor.source, target: descriptor.target, disposition: "reused" }); continue; }
    if (descriptor.disposition === "delete") {
      if (!previous?.head.version) throw new Error("fixture deletion lacks prior version");
      const version = previous.head.version;
      previous.head = { ...previous.head, version: null, body_ref: null, binding_state: "tombstoned", bound_artifact: null,
        previous_version: version, cause: "native_delete", tombstone: { object_kind: kind, object_id: id,
          object_revision: version.object_revision, native_cursor: ++cursor, last_payload_hash: version.payload_hash } };
      previous.bodies = [];
      mappings.push({ source: descriptor.source, target: descriptor.target, disposition: "deleted" }); continue;
    }
    const rows = prepared.request.rows;
    const row = kind === "bank" ? rows.bank : [...rows.documents, ...rows.memory_units, ...rows.mental_models, ...rows.directives]
      .find((value) => value.source.source_kind === kind && value.source.source_id === descriptor.source.source_id);
    if (!row) throw new Error("fixture upsert lacks structured body");
    const revision = (descriptor.target?.object_revision ?? 0) + 1;
    let payload: object; let source: Parameters<typeof applicationTestNative>[0]["source"];
    if ("payload" in row) payload = row.payload;
    else if ("original_text" in row) {
      const fields = Object.fromEntries(Object.entries(row).filter(([key]) => !["source", "original_text", "context"].includes(key)));
      payload = { ...fields, bank_id: scope.bankId, document_id: id };
      source = { text: row.original_text, context: row.context, metadata: row.metadata };
    } else if ("source_memory_ids" in row) {
      const fields = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "source"));
      payload = { ...fields, bank_id: scope.bankId, memory_id: id, revision,
        document_id: row.document_id === null ? null : target("document", row.document_id),
        source_memory_ids: row.source_memory_ids.map((value) => target("memory_unit", value)) };
    } else {
      const fields = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "source"));
      payload = { ...fields, bank_id: scope.bankId, [kind === "mental_model" ? "mental_model_id" : "directive_id"]: id };
    }
    const node = applicationTestNative({ scope, kind, payload: TakiApplicationNativePayloadSchema.parse(payload), revision, cursor: ++cursor, source });
    if (previous) native.splice(native.indexOf(previous), 1, node); else native.push(node);
    const version = node.head.version!;
    mappings.push({ source: descriptor.source, target: { object_kind: kind, object_id: id,
      object_revision: version.object_revision, payload_hash: version.payload_hash }, disposition: "upserted" });
  }
  return { mappings, cursor };
}
