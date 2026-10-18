/**
 * INPUT:  frozen Shared lifecycle documents and complete native snapshot evidence
 * OUTPUT: codec-compatible SHA-256, strict selector/proof checks and bounded request construction
 * POS:    Core pure integrity boundary; authenticating the transport remains the Native client responsibility
 */
import { createHash } from "node:crypto";
import { HINDSIGHT_TEMPLATE_MAX_BYTES, HindsightTemplateSnapshotSchema, HindsightTemplateApplyRequestSchema,
  hindsightTemplateHashJson, normalizeHindsightTemplateSnapshot, normalizeHindsightTemplateRequest,
  HindsightTemplateLabelsSchema, type HindsightTemplateSnapshot, type HindsightTemplateApplyRequest,
  type HindsightTemplateHashDomain } from "@taki/shared";
import { withoutApplicationHash } from "../hindsight-application-integrity.ts";

export function templateHash(domain: HindsightTemplateHashDomain, value: unknown): string {
  return createHash("sha256").update(hindsightTemplateHashJson(domain, value)).digest("hex");
}
export function templateEqual(left: unknown, right: unknown): boolean {
  return hindsightTemplateHashJson("definition", left) === hindsightTemplateHashJson("definition", right);
}
export function assertTemplateBodyBound(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > HINDSIGHT_TEMPLATE_MAX_BYTES) throw new Error("HINDSIGHT_TEMPLATE_INVALID");
}
export function verifyTemplateSnapshot(input: HindsightTemplateSnapshot): HindsightTemplateSnapshot {
  assertTemplateBodyBound(input);
  const value = normalizeHindsightTemplateSnapshot(HindsightTemplateSnapshotSchema.parse(input));
  const { snapshot_hash: hash, ...body } = value;
  if (templateHash("snapshot", body) !== hash) invalid();
  if (!templateEqual(value.config.map((item) => item.key), value.selectors.config_keys)
    || !templateEqual(value.models.map((item) => item.id), value.selectors.model_ids)
    || !templateEqual(value.directives.map(({ id, name }) => ({ id, name })), value.selectors.directives)) invalid();
  for (const entry of value.config) {
    if (entry.key === "entity_labels") {
      HindsightTemplateLabelsSchema.parse(entry.inherited);
      if (entry.stored.kind === "value") HindsightTemplateLabelsSchema.parse(entry.stored.value);
    } else if (typeof entry.inherited !== "string" && entry.inherited !== null
      || entry.stored.kind === "value" && typeof entry.stored.value !== "string") invalid();
  }
  for (const item of [...value.models, ...value.directives]) {
    if (item.definition && item.proof?.definition_hash !== templateHash("definition", item.definition)) invalid();
  }
  return value;
}
export function signTemplateRequest(input: HindsightTemplateApplyRequest): HindsightTemplateApplyRequest {
  const value = normalizeHindsightTemplateRequest(HindsightTemplateApplyRequestSchema.parse(input));
  const body = withoutApplicationHash(value, "request_hash");
  const signed = { ...value, request_hash: templateHash("request", body) };
  assertTemplateBodyBound(signed);
  return signed;
}
function invalid(): never { throw new Error("HINDSIGHT_RESPONSE_INVALID"); }
