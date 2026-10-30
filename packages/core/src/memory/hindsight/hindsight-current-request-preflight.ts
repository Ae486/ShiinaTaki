/**
 * INPUT:  a structurally valid D78 request built from complete current Local evidence
 * OUTPUT: explicit native PostgreSQL/depth/subtype representation gaps before network submission
 * POS:    core/memory/hindsight — mirrors native current_state_preflight; Canonical field validity is unchanged
 */
import { HINDSIGHT_CURRENT_STATE_MAX_RECORDS, type HindsightCurrentTransferRequest, type HindsightCurrentPreparationGap } from "@taki/shared";

const MAX_NATIVE_JSON_DEPTH = 64;
const NATIVE_MODEL_SUBTYPES = new Set(["structural", "emergent", "pinned", "learned"]);

export function currentRequestRepresentationGaps(request: HindsightCurrentTransferRequest): HindsightCurrentPreparationGap[] {
  const found = new Set<"native_text_nul" | "native_json_depth">();
  inspectValue(request, 0, found);
  const gaps: HindsightCurrentPreparationGap[] = [...found].map((code) => ({ code, objectKind: "bank", objectId: request.source_bank.source_id }));
  if (request.chunks.length > HINDSIGHT_CURRENT_STATE_MAX_RECORDS
    || request.supersede.length + request.preserve.length > HINDSIGHT_CURRENT_STATE_MAX_RECORDS) {
    gaps.push({ code: "native_record_limit", objectKind: "bank", objectId: request.source_bank.source_id });
  }
  for (const model of request.mental_models) {
    if (!NATIVE_MODEL_SUBTYPES.has(model.subtype)) gaps.push({ code: "native_model_subtype", objectKind: "mental_model", objectId: model.source.source_id });
  }
  return gaps;
}

function inspectValue(value: unknown, depth: number, found: Set<"native_text_nul" | "native_json_depth">): void {
  if (depth > MAX_NATIVE_JSON_DEPTH) { found.add("native_json_depth"); return; }
  if (typeof value === "string") {
    // Removing U+0000 would change Canonical text, while PostgreSQL text and JSONB cannot store it.
    if (value.includes("\u0000")) found.add("native_text_nul");
  } else if (Array.isArray(value)) {
    for (const child of value) inspectValue(child, depth + 1, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      inspectValue(key, depth + 1, found); inspectValue(child, depth + 1, found);
    }
  }
}
