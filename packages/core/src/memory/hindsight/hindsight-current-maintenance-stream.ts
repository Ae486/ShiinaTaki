/**
 * INPUT:  a complete native finite maintenance evidence stream and its certificate
 * OUTPUT: full ordinal/count/required-set/reference validation with no caller-selected subset
 * POS:    core/memory/hindsight — D78 evidence integrity; native producers own semantic decisions
 */
import type { HindsightCutoverCertificate, HindsightCutoverEvidenceRecord, HindsightCutoverRequirement } from "@taki/shared";
import { hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";
import { currentRequirementKey, currentRequiredSetHash, currentInputManifestHash, currentWitnessListHash,
  currentActionKey } from "./hindsight-current-maintenance-hash.ts";

export function verifyCurrentMaintenanceStream(records: HindsightCutoverEvidenceRecord[], certificate: HindsightCutoverCertificate): void {
  const requirements = records.filter((record) => record.record_kind === "requirement").map((record) => record.requirement);
  const outcomes = records.filter((record) => record.record_kind === "outcome");
  const actions = records.filter((record) => record.record_kind === "action");
  const inputs = records.filter((record) => record.record_kind === "input");
  const models = records.filter((record) => record.record_kind === "model");
  const counts = { requirements: requirements.length, outcomes: outcomes.length, inputs: inputs.length, actions: actions.length, models: models.length };
  if (records.some((record, index) => record.ordinal !== index) || records.length !== certificate.evidence.total_records
    || hindsightCurrentStateHash(records) !== certificate.evidence.records_hash
    || hindsightCurrentStateHash(counts) !== hindsightCurrentStateHash(certificate.evidence.counts)) fail();
  const required = new Map(requirements.map((requirement) => [requirement.requirement_key, requirement]));
  if (required.size !== requirements.length || outcomes.length !== requirements.length
    || new Set(outcomes.map((outcome) => outcome.requirement_key)).size !== required.size
    || requirements.some((requirement) => requirement.requirement_key !== currentRequirementKey(requirement))
    || currentRequiredSetHash(requirements) !== certificate.required_set_hash
    || requirements.filter((item) => item.kind === "source_scope").length !== certificate.source_scope_count
    || requirements.filter((item) => item.kind === "mental_model").length !== certificate.model_count) fail();
  const actionMap = new Map(actions.map((action) => [action.action_key, action]));
  if (actionMap.size !== actions.length) fail();
  for (const outcome of outcomes) {
    if (!required.has(outcome.requirement_key) || new Set(outcome.action_keys).size !== outcome.action_keys.length
      || outcome.verified_cursor > certificate.snapshot.manifest.end_cursor) fail();
    for (const key of outcome.action_keys) if (!actionMap.get(key)?.requirement_keys.includes(outcome.requirement_key)) fail();
  }
  for (const action of actions) {
    if (action.action_key !== currentActionKey(certificate.verification_id, action)
      || action.requirement_keys.length === 0 || new Set(action.requirement_keys).size !== action.requirement_keys.length
      || action.requirement_keys.some((key) => !outcomes.some((outcome) => outcome.requirement_key === key && outcome.action_keys.includes(action.action_key)))) fail();
    const batch = action.journal_batch;
    if (action.verified_cursor > certificate.snapshot.manifest.end_cursor || batch && (batch.provider_lineage !== certificate.provider_lineage
      || batch.bank_generation !== certificate.bank_generation || batch.size !== batch.last_cursor - batch.first_cursor + 1
      || batch.last_cursor > action.verified_cursor)) fail();
  }
  if (inputs.some((record) => !required.has(record.requirement_key))
    || models.some((record) => required.get(record.requirement_key)?.kind !== "mental_model")
    || new Set(models.map((record) => record.requirement_key)).size !== models.length) fail();
  verifyInputGroups({ inputs, outcomes, actions });
  verifyModels({ requirements, outcomes, models, inputs });
}

function verifyModels(input: { requirements: HindsightCutoverRequirement[];
  outcomes: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "outcome" }>>;
  models: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "model" }>>;
  inputs: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "input" }>> }): void {
  for (const requirement of input.requirements.filter((item) => item.kind === "mental_model")) {
    const models = input.models.filter((record) => record.requirement_key === requirement.requirement_key);
    const outcome = input.outcomes.find((record) => record.requirement_key === requirement.requirement_key);
    if (models.length !== 1 || !outcome) fail();
  }
  for (const model of input.models) {
    if (model.prompt_truncated || model.skipped_operation_count !== 0
      || model.outcome === "refresh_failed_empty_candidate" || model.outcome === "refresh_failed_delta_not_applied") fail();
    const outcome = input.outcomes.find((record) => record.requirement_key === model.requirement_key);
    if (!outcome) fail();
    // Interrupted native actions keep earlier input groups. The final model receipt describes only its final group.
    const records = input.inputs.filter((record) => record.requirement_key === model.requirement_key
      && record.input_manifest_hash === outcome.input_manifest_hash);
    for (const role of ["eligible", "retrieved", "consumed"] as const) {
      if (model[`${role}_hash`] !== currentWitnessListHash(records.filter((record) => record.role === role).map((record) => record.witness))) fail();
    }
    if (model.lifecycle_hash !== currentWitnessListHash(records.filter((record) => record.role === "lifecycle").map((record) => record.lifecycle))) fail();
  }
}

function verifyInputGroups(input: {
  inputs: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "input" }>>;
  outcomes: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "outcome" }>>;
  actions: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "action" }>>;
}): void {
  const groups = new Map<string, typeof input.inputs>();
  for (const record of input.inputs) groups.set(record.input_manifest_hash, [...groups.get(record.input_manifest_hash) ?? [], record]);
  for (const [hash, records] of groups) if (currentInputManifestHash(records) !== hash) fail();
  for (const record of [...input.outcomes, ...input.actions]) {
    if (!groups.has(record.input_manifest_hash) && record.input_manifest_hash !== currentInputManifestHash([])) fail();
  }
}
function fail(): never { throw new Error("HINDSIGHT_CURRENT_MAINTENANCE_EVIDENCE_INVALID"); }
