/**
 * INPUT:  exact native finite requirement/input/action records
 * OUTPUT: hashes mirrored from cutover_verification.py public composition helpers
 * POS:    core/memory/hindsight — D78 cross-language evidence integrity, separate from snapshot SHA-256
 */
import { hindsightCurrentStateJson, type HindsightCutoverRequirement, type HindsightCutoverEvidenceRecord } from "@taki/shared";
import { currentStateFieldsWithout, hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";

export function currentRequirementKey(requirement: HindsightCutoverRequirement): string {
  const body = currentStateFieldsWithout(requirement, ["requirement_key"]);
  return hindsightCurrentStateHash({ domain: "cutover-requirement.v1", ...body });
}
export function currentRequiredSetHash(requirements: HindsightCutoverRequirement[]): string {
  return hindsightCurrentStateHash([...requirements].sort((left, right) => left.requirement_key < right.requirement_key ? -1 : left.requirement_key > right.requirement_key ? 1 : 0));
}
export function currentInputManifestHash(records: Array<Extract<HindsightCutoverEvidenceRecord, { record_kind: "input" }>>): string {
  return currentWitnessListHash(records.map((record) => currentStateFieldsWithout(record, ["ordinal", "record_kind", "input_manifest_hash"])));
}
export function currentWitnessListHash(values: unknown[]): string {
  const unique = new Map(values.map((value) => [hindsightCurrentStateJson(value), value]));
  return hindsightCurrentStateHash([...unique.keys()].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map((key) => unique.get(key)));
}
export function currentActionKey(verificationId: string, action: Extract<HindsightCutoverEvidenceRecord, { record_kind: "action" }>): string {
  return hindsightCurrentStateHash({ domain: "cutover-action.v1", verification_id: verificationId,
    step_key: action.step_key, plan_id: action.plan_id, action_index: action.action_index, action: action.action });
}
