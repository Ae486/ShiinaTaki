/**
 * INPUT:  deterministic fixture definitions and pure preview output
 * OUTPUT: isolated signed Native-shaped snapshots/receipts for Core unit tests
 * POS:    test support only; does not prove Native authentication, SQL atomicity or provider execution
 */
import { randomUUID } from "node:crypto";
import { normalizeHindsightTemplateSnapshot, normalizeHindsightTemplateReceipt,
  type HindsightTemplateSnapshot, type HindsightTemplateReceipt, type HindsightTemplateModelDefinition } from "@taki/shared";
import { hindsightBankBindings } from "../hindsight-bank-identity.ts";
import { withoutApplicationHash } from "../hindsight-application-integrity.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";
import { emptyTemplateUserRevision, type TemplateBankIdentity } from "./template-overlay-schema.ts";
import { captureTemplateEnrollment, selectTemplateResources } from "./template-enrollment.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";
import { previewTemplateOverlay, type TemplatePreview } from "./template-preview.ts";

export const FIXTURE_LINEAGE = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_GENERATION = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_DIRECTIVE = "33333333-3333-4333-8333-333333333333";
export const FIXTURE_AT = "2026-10-07T00:00:00.000Z";
export function fixtureProof(definition: unknown, revision = 1): NonNullable<HindsightTemplateSnapshot["models"][number]["proof"]> {
  return { revision, payload_hash: templateHash("definition", { definition, revision }), definition_hash: templateHash("definition", definition),
    deletion_hash: templateHash("deletion", { definition, revision, history: ["fixture history"], embedding: [0.1, -0.2] }),
    history_count: 2, dependency_count: 3, has_generated_content: true };
}
export function signFixtureSnapshot(input: HindsightTemplateSnapshot): HindsightTemplateSnapshot {
  const value = normalizeHindsightTemplateSnapshot(input);
  return { ...value, snapshot_hash: templateHash("snapshot", withoutApplicationHash(value, "snapshot_hash")) };
}
export function templateFixture(scope: "global" | "character" = "global") {
  const binding = hindsightBankBindings("fixture-character")[scope === "global" ? 0 : 1];
  const identity: TemplateBankIdentity = { scope, canonicalIdentity: binding.canonicalIdentity,
    target: { provider_lineage: FIXTURE_LINEAGE, bank_id: binding.externalBankId, bank_generation: FIXTURE_GENERATION } };
  const template = loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, scope); const user = emptyTemplateUserRevision();
  const selectors = selectTemplateResources({ template, user,
    directiveIds: template.directives.map((item) => ({ id: FIXTURE_DIRECTIVE, name: item.name })) });
  const snapshot = signFixtureSnapshot({ contract_version: "1.0.0", target: identity.target, selectors,
    config: selectors.config_keys.map((key) => ({ key, stored: { kind: "absent" },
      inherited: key === "entity_labels" ? [{ key: "parent-group", type: "text" }] : "Native inherited instruction" })),
    models: selectors.model_ids.map((id) => ({ id, definition: null, proof: null })),
    directives: selectors.directives.map((item) => ({ ...item, definition: null, proof: null, name_matches: [] })), snapshot_hash: "0".repeat(64) });
  const enrollment = captureTemplateEnrollment({ identity, snapshot, mode: "fresh" });
  const input = { enrollment, snapshot, template, user, requestId: randomUUID(), previous: null };
  const preview = previewTemplateOverlay(input);
  return { identity, template, user, snapshot, enrollment, input, preview };
}
export function fixtureCommit(preview: TemplatePreview): { snapshot: HindsightTemplateSnapshot; receipt: HindsightTemplateReceipt } {
  const before = preview.request.expected_snapshot;
  const snapshot = signFixtureSnapshot({ ...preview.projection, snapshot_hash: "0".repeat(64),
    models: preview.projection.models.map((item) => ({ ...item, proof: committedFixtureProof(item.definition, before.models.find((old) => old.id === item.id)) })),
    directives: preview.projection.directives.map((item) => ({ ...item, proof: committedFixtureProof(item.definition, before.directives.find((old) => old.id === item.id)) })) });
  const journalBefore = Math.max(1, ...[...before.models, ...before.directives].map((item) => item.proof?.revision ?? 0));
  const changes = preview.request.changes;
  const logicalChanges = Number(changes.config.length > 0) + changes.models.length + changes.directives.length;
  const receipt = normalizeHindsightTemplateReceipt({ contract_version: "1.0.0", target: preview.request.target,
    request_id: preview.request.request_id, request_hash: preview.request.request_hash,
    before_snapshot_hash: preview.request.expected_snapshot.snapshot_hash, after_snapshot_hash: snapshot.snapshot_hash,
    changes: preview.request.changes, children: preview.request.refresh.map((item) => {
      const proof = snapshot.models.find((model) => model.id === item.model_id)?.proof;
      if (!proof) throw new Error("missing fixture proof");
      return { ...item, definition_hash: proof.definition_hash, object_revision: proof.revision, object_payload_hash: proof.payload_hash };
    }), journal_before: journalBefore, journal_after: journalBefore + logicalChanges,
    initialization_proof_hash: null, receipt_hash: "0".repeat(64) });
  const body = withoutApplicationHash(receipt, "receipt_hash");
  return { snapshot, receipt: { ...receipt, receipt_hash: templateHash("receipt", body) } };
}

function committedFixtureProof(definition: unknown, before?: { definition: unknown; proof: ReturnType<typeof fixtureProof> | null }) {
  if (definition === null) return null;
  if (before?.proof && templateEqual(before.definition, definition)) return structuredClone(before.proof);
  return fixtureProof(definition, (before?.proof?.revision ?? 1) + 1);
}

export function customModel(id = "user-model"): HindsightTemplateModelDefinition {
  return { id, name: "User complete model", source_query: "User query", tags: [], max_tokens: 1024,
    trigger: { mode: "delta", refresh_cron: null, tag_groups: [{ not: { tags: ["private"], match: "any" } }],
      response_schema: { type: "object", properties: { "emoji😀": { type: "string" } } }, keep_trace: false } };
}
