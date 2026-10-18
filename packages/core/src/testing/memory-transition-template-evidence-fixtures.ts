/**
 * INPUT:  independently held template Native maps and complete application fixture Banks
 * OUTPUT: complete synthetic W2 native/application/auxiliary closure retaining full template resources and receipts
 * POS:    healthy test evidence only; immutable persisted associations are never rewritten by this helper
 */
import { randomUUID } from "node:crypto";
import { TakiApplicationNativePayloadSchema, type MemoryTransitionNativeEvidence } from "@taki/shared";
import type { TemplateLifecycleFixture } from "../memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { applicationTestArtifact, applicationTestBankPayload, applicationTestNative } from "./hindsight-application-fixtures.ts";
import { applicationTestBind } from "./hindsight-application-runtime-fixtures.ts";
import { evidenceFromBundle, W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { sealTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import type { TemplateRefreshFixtureResult } from "./hindsight-template-observation-fixtures.ts";

export function templateTransitionEvidence(fixture: TemplateLifecycleFixture, refreshResults: Map<string, TemplateRefreshFixtureResult>) {
  return fixture.base.banks.map((bank) => {
    const snapshot = fixture.native.snapshots.get(bank.scope.bankId);
    const config = Object.fromEntries((snapshot?.config ?? []).flatMap(({ key, stored }) => stored.kind === "absent" ? []
      : [[key, stored.kind === "null_tombstone" ? null : stored.value]]));
    const nativeBank = applicationTestNative({ scope: bank.scope, kind: "bank", cursor: 10, revision: 3,
      payload: TakiApplicationNativePayloadSchema.parse({ ...applicationTestBankPayload(bank.scope), config }) });
    const original = bank.artifacts.find((value) => value.artifact.key.artifact_kind === "bank");
    if (!original || !nativeBank.head.version) throw new Error("template fixture requires a complete Bank artifact");
    const artifact = applicationTestArtifact({ scope: bank.scope, key: original.artifact.key, body: original.body,
      revision: original.artifact.revision + 1, binding: { kind: "exact_native", native: nativeBank.head.version } });
    applicationTestBind(nativeBank, artifact.artifact);
    const models = (snapshot?.models ?? []).flatMap(({ definition }, index) => definition ? [applicationTestNative({
      scope: bank.scope, kind: "mental_model", cursor: 11 + index,
      payload: TakiApplicationNativePayloadSchema.parse({ mental_model_id: definition.id, bank_id: bank.scope.bankId,
        subtype: "mental_model", name: definition.name, source_query: definition.source_query, content: "Fixture generated content.",
        tags: definition.tags, max_tokens: definition.max_tokens, trigger: definition.trigger, last_refreshed_at: W3_AT,
        created_at: W3_AT, reflect_response: null, structured_content: null }) })] : []);
    const directives = (snapshot?.directives ?? []).flatMap(({ definition }, index) => definition ? [applicationTestNative({
      scope: bank.scope, kind: "directive", cursor: 11 + models.length + index,
      payload: TakiApplicationNativePayloadSchema.parse({ directive_id: definition.id, bank_id: bank.scope.bankId,
        name: definition.name, content: definition.content, priority: definition.priority, is_active: definition.is_active,
        tags: definition.tags, created_at: W3_AT, updated_at: W3_AT }) })] : []);
    return withTemplateAuxiliary(evidenceFromBundle({ transitionId: randomUUID(), scope: bank.scope,
      native: [nativeBank, ...models, ...directives], artifacts: [...bank.artifacts, artifact] }), fixture, refreshResults);
  });
}

/** Native tables use id, while the native snapshot payload uses mental_model_id/directive_id. */
export function withTemplateAuxiliary(evidence: MemoryTransitionNativeEvidence, fixture: TemplateLifecycleFixture,
  results: Map<string, TemplateRefreshFixtureResult>): MemoryTransitionNativeEvidence {
  if (evidence.templateBackup) throw new Error("cannot rewrite a persisted template association");
  const bankId = evidence.status.bank_id;
  const records = evidence.auxiliaryPages.flatMap((page) => page.records).filter((row) =>
    !["memory_template_receipts", "memory_template_refresh_results"].includes(row.table)).map((row) => {
    if (!["mental_models", "directives"].includes(row.table)) return row;
    const value = JSON.parse(row.row_json) as Record<string, unknown>;
    const key = row.table === "mental_models" ? "mental_model_id" : "directive_id";
    if (value[key] !== undefined) { value.id = value[key]; delete value[key]; }
    return { ...row, row_json: JSON.stringify(value) };
  });
  for (const receipt of fixture.native.receipts.values()) if (receipt.target.bank_id === bankId) records.push({
    table: "memory_template_receipts", row_json: JSON.stringify({ bank_id: bankId, provider_lineage: receipt.target.provider_lineage,
      bank_generation: receipt.target.bank_generation, request_id: receipt.request_id, request_hash: receipt.request_hash, receipt }) });
  for (const result of results.values()) if (result.target.bank_id === bankId) records.push({ table: "memory_template_refresh_results",
    row_json: JSON.stringify({ bank_id: bankId, child_id: result.child_id, result }) });
  return resealTemplateAuxiliary(evidence, records);
}

export function resealTemplateAuxiliary(evidence: MemoryTransitionNativeEvidence,
  records: MemoryTransitionNativeEvidence["auxiliaryPages"][number]["records"]): MemoryTransitionNativeEvidence {
  if (evidence.templateBackup) throw new Error("test auxiliary reseal requires unassociated W2 evidence");
  const value = structuredClone(evidence); const proof = value.status.proof;
  if (!proof) throw new Error("fixture W2 proof missing");
  proof.auxiliary_records_hash = hindsightTransitionHash(records);
  proof.auxiliary_page_hashes = [hindsightTransitionHash({ page_number: 0, records })];
  proof.baseline_hash = hindsightTransitionHash({ domain: "transition-baseline.v1", bank_id: proof.bank_id,
    provider_lineage: proof.provider_lineage, bank_generation: proof.bank_generation,
    native_cursor: proof.native_snapshot.manifest.end_cursor, application_checkpoint: proof.application_snapshot.checkpoint,
    native_records_hash: proof.native_records_hash, application_records_hash: proof.application_records_hash,
    auxiliary_records_hash: proof.auxiliary_records_hash });
  proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1",
    proof: Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")) });
  for (const page of value.maintenancePages) page.certificate_hash = proof.proof_hash;
  value.auxiliaryPages = [{ transition_id: value.transitionId, bank_id: proof.bank_id, proof_hash: proof.proof_hash,
    page_number: 0, total_pages: 1, records, page_hash: proof.auxiliary_page_hashes[0]! }];
  return sealTransitionNativeEvidence(value);
}
