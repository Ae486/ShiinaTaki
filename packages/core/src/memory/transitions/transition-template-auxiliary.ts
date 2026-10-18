/**
 * INPUT:  complete hash-verified W2 auxiliary rows and one receipt-bound original template request
 * OUTPUT: independently reconstructed receipt inventory and database-only definition facet
 * POS:    healthy template/W2 join; generated content and inherited configuration are deliberately separate
 */
import { HindsightTemplateReceiptSchema, HindsightTemplateRefreshResultSchema, normalizeHindsightTemplateReceipt, normalizeHindsightTemplateSelectors,
  HindsightTemplateModelDefinitionSchema, HindsightTemplateDirectiveDefinitionSchema,
  isHindsightTemplateConfigValue, parseHindsightApplicationJson, hindsightTemplateBackupReceiptsValue,
  type HindsightBackupNativeRequestV2, type HindsightTemplateTarget, type HindsightTemplateReceipt, type MemoryTransitionNativeEvidence,
  type HindsightTemplatePresence, type HindsightTemplateConfigKey, type HindsightTemplateSelectors } from "@taki/shared";
import { templateEqual, templateHash } from "../hindsight/template-lifecycle/template-integrity.ts";
import { hindsightBackupHash } from "../hindsight-backup/hindsight-template-backup-integrity.ts";

type Row = Record<string, unknown>;
export function readTransitionTemplateAuxiliary(evidence: MemoryTransitionNativeEvidence, request: HindsightBackupNativeRequestV2) {
  const entry = request.templates[0]; if (!entry || request.templates.length !== 1) invalid();
  const receipts = auxiliaryRows(evidence, "memory_template_receipts")
    .filter((row) => row.provider_lineage === entry.target.provider_lineage && row.bank_generation === entry.target.bank_generation)
    .map((row) => verifiedReceipt(row, entry.target));
  if (new Set(receipts.map((receipt) => receipt.request_id)).size !== receipts.length) invalid();
  verifyMembership(receipts, auxiliaryRows(evidence, "memory_template_refresh_results"), request.operationIds);
  const tuples = receipts.map((receipt) => ({ request_id: receipt.request_id, request_hash: receipt.request_hash, receipt_hash: receipt.receipt_hash }));
  const receiptInventory = { count: tuples.length,
    digest: hindsightBackupHash("receipts", hindsightTemplateBackupReceiptsValue(entry.target, tuples)) };
  if (!entry.selected) return { receiptInventory, databaseDefinitionHash: null };
  const selected = entry.selected;
  const receipt = receipts.find((value) => value.request_id === selected.request.request_id);
  if (!receipt || receipt.request_hash !== selected.request.request_hash || receipt.receipt_hash !== selected.receiptHash) invalid();
  const projection = databaseProjection(evidence, { target: entry.target, selectors: selected.request.expected_snapshot.selectors });
  return { receiptInventory, databaseDefinitionHash: hindsightBackupHash("database", projection) };
}

/** Membership is separate from complete Apply inventory: an intact receipt does not prove its terminal child marker. */
function verifyMembership(receipts: HindsightTemplateReceipt[], rows: Row[], operationIds: string[]): void {
  const wanted = new Set(operationIds); const found = new Set<string>();
  for (const receipt of receipts) {
    const receiptId = "template-receipt:" + receipt.request_id;
    if (wanted.has(receiptId)) found.add(receiptId);
    if (new Set(receipt.children.map((child) => child.child_id)).size !== receipt.children.length) invalid();
    for (const child of receipt.children) {
      const key = "template-refresh-result:" + child.child_id;
      if (!wanted.has(key)) continue;
      const matches = rows.filter((row) => row.child_id === child.child_id);
      const row = matches[0]; if (matches.length !== 1 || !row) invalid();
      const value = HindsightTemplateRefreshResultSchema.parse(jsonValue(row.result));
      if (!["completed", "superseded", "failed"].includes(value.state) || !templateEqual(value.target, receipt.target)
        || value.request_id !== receipt.request_id || value.child_id !== child.child_id || row.bank_id !== receipt.target.bank_id
        || value.model_id !== child.model_id || value.definition_hash !== child.definition_hash
        || (value.result_revision === null) !== (value.result_payload_hash === null)
        || value.state === "completed" && value.result_revision === null) invalid();
      found.add(key);
    }
  }
  if (found.size !== wanted.size) invalid();
}

function verifiedReceipt(row: Row, target: HindsightTemplateTarget) {
  const receipt = normalizeHindsightTemplateReceipt(HindsightTemplateReceiptSchema.parse(jsonValue(row.receipt)));
  const { receipt_hash: hash, ...body } = receipt;
  if (!templateEqual(receipt.target, target) || receipt.target.bank_id !== row.bank_id
    || receipt.target.provider_lineage !== row.provider_lineage || receipt.target.bank_generation !== row.bank_generation
    || receipt.request_id !== row.request_id || receipt.request_hash !== row.request_hash || hash !== templateHash("receipt", body)) invalid();
  return receipt;
}

function databaseProjection(evidence: MemoryTransitionNativeEvidence,
  input: { target: HindsightTemplateTarget; selectors: HindsightTemplateSelectors }) {
  const selectors = normalizeHindsightTemplateSelectors(input.selectors);
  const banks = auxiliaryRows(evidence, "banks");
  if (banks.length !== 1 || banks[0]?.bank_id !== input.target.bank_id) invalid();
  if (!Object.hasOwn(banks[0], "config")) invalid();
  const rawConfig = jsonValue(banks[0].config);
  const config = objectValue(rawConfig === null ? {} : rawConfig);
  return { contract_version: "1.0.0", target: input.target, selectors,
    config: selectors.config_keys.map((key) => ({ key, stored: storedConfig(config, key) })),
    models: modelDefinitions(auxiliaryRows(evidence, "mental_models"), selectors),
    directives: directiveDefinitions(auxiliaryRows(evidence, "directives"), selectors) };
}
function storedConfig(config: Row, key: HindsightTemplateConfigKey): HindsightTemplatePresence {
  if (!Object.hasOwn(config, key)) return { kind: "absent" };
  const value = config[key];
  if (value === null) return { kind: "null_tombstone" };
  if (!isHindsightTemplateConfigValue(key, value)) invalid();
  // The shared value validator preserves complete nested label/trigger values and their meaningful array order.
  return { kind: "value", value: value as Extract<HindsightTemplatePresence, { kind: "value" }>["value"] };
}
function modelDefinitions(rows: Row[], selectors: HindsightTemplateSelectors) {
  const byId = uniqueRows(rows);
  return selectors.model_ids.map((id) => {
    const row = byId.get(id);
    const definition = row ? HindsightTemplateModelDefinitionSchema.parse({ id: row.id, name: row.name,
      source_query: row.source_query, tags: row.tags, max_tokens: row.max_tokens, trigger: jsonValue(row.trigger) }) : null;
    return { id, definition };
  });
}
function directiveDefinitions(rows: Row[], selectors: HindsightTemplateSelectors) {
  const byId = uniqueRows(rows);
  return selectors.directives.map(({ id, name }) => {
    const row = byId.get(id);
    const definition = row ? HindsightTemplateDirectiveDefinitionSchema.parse({ id: row.id, name: row.name,
      content: row.content, priority: row.priority, is_active: row.is_active, tags: row.tags }) : null;
    const name_matches = rows.filter((value) => value.name === name).map((value) => {
      if (typeof value.id !== "string") invalid(); return value.id;
    }).sort();
    if (name_matches.length > 64) invalid();
    return { id, name, definition, name_matches };
  });
}
function auxiliaryRows(evidence: MemoryTransitionNativeEvidence, table: string): Row[] {
  return evidence.auxiliaryPages.flatMap((page) => page.records).filter((value) => value.table === table).map((value) => {
    const row = objectValue(parseHindsightApplicationJson(value.row_json));
    if (row.bank_id !== evidence.status.bank_id) invalid();
    return row;
  });
}
function uniqueRows(rows: Row[]): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of rows) {
    if (typeof row.id !== "string" || result.has(row.id)) invalid();
    result.set(row.id, row);
  }
  return result;
}
function jsonValue(value: unknown): unknown { return typeof value === "string" ? parseHindsightApplicationJson(value) : value; }
function objectValue(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Row;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
