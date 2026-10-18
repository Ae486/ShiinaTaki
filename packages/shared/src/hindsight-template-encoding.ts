/**
 * INPUT:  validated snake_case lifecycle domain values
 * OUTPUT: domain-separated canonical bytes using the unchanged current-state codec
 * POS:    shared template hashing — only identity sets sort; ordered tags/trigger/label arrays keep their order
 */
import { hindsightCurrentStateJson } from "./hindsight-current-state-encoding.ts";
import type { HindsightTemplateSelectors } from "./hindsight-template-definition-schema.ts";
import type { HindsightTemplateApplyRequest, HindsightTemplateChanges, HindsightTemplateReceipt,
  HindsightTemplateSnapshot } from "./hindsight-template-schema.ts";

export type HindsightTemplateHashDomain = "request" | "snapshot" | "definition" | "deletion" | "receipt";
export function hindsightTemplateHashJson(domain: HindsightTemplateHashDomain, value: unknown): string {
  return hindsightCurrentStateJson({ domain: `taki-template-${domain}.v1`, value });
}
export function normalizeHindsightTemplateSelectors(value: HindsightTemplateSelectors): HindsightTemplateSelectors {
  return { config_keys: [...value.config_keys].sort(compare), model_ids: [...value.model_ids].sort(compare),
    directives: sortIdentity(value.directives, (item) => item.id) };
}
export function normalizeHindsightTemplateSnapshot(value: HindsightTemplateSnapshot): HindsightTemplateSnapshot {
  return { ...value, selectors: normalizeHindsightTemplateSelectors(value.selectors),
    config: sortIdentity(value.config, (item) => item.key), models: sortIdentity(value.models, (item) => item.id),
    directives: sortIdentity(value.directives, (item) => item.id).map((item) => ({ ...item, name_matches: [...item.name_matches].sort(compare) })) };
}
export function normalizeHindsightTemplateChanges(value: HindsightTemplateChanges): HindsightTemplateChanges {
  return { config: sortIdentity(value.config, (item) => item.key),
    models: sortIdentity(value.models, (item) => item.kind === "upsert" ? item.definition.id : item.id),
    directives: sortIdentity(value.directives, (item) => item.kind === "upsert" ? item.definition.id : item.id) };
}
export function normalizeHindsightTemplateRequest(value: HindsightTemplateApplyRequest): HindsightTemplateApplyRequest {
  return { ...value, expected_snapshot: normalizeHindsightTemplateSnapshot(value.expected_snapshot),
    changes: normalizeHindsightTemplateChanges(value.changes), refresh: sortIdentity(value.refresh, (item) => item.model_id) };
}
export function normalizeHindsightTemplateReceipt(value: HindsightTemplateReceipt): HindsightTemplateReceipt {
  return { ...value, changes: normalizeHindsightTemplateChanges(value.changes), children: sortIdentity(value.children, (item) => item.model_id) };
}
function sortIdentity<T>(values: T[], identity: (value: T) => string): T[] {
  return [...values].sort((left, right) => compare(identity(left), identity(right)));
}
function compare(left: string, right: string): number {
  const encoder = new TextEncoder(); const a = encoder.encode(left); const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference;
  }
  return a.length - b.length;
}
