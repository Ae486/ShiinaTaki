/**
 * INPUT:  a reviewed exact request, original Native receipt and coherent post-application readback
 * OUTPUT: original receipt/current revision validation and creation ownership from absent -> inserted receipts
 * POS:    Core overlay evidence boundary; current definitions alone never prove historical application
 */
import { z } from "zod";
import { HindsightTemplateApplyRequestSchema, HindsightTemplateReceiptSchema, HindsightTemplateSnapshotSchema,
  normalizeHindsightTemplateReceipt, type HindsightTemplateReceipt, type HindsightTemplateSnapshot } from "@taki/shared";
import { TemplateProjectionSchema, projectTemplateSnapshot } from "./template-projection.ts";
import { signTemplateRequest, templateEqual, templateHash, verifyTemplateSnapshot } from "./template-integrity.ts";
import type { TemplatePreview, TemplateOwnership } from "./template-preview.ts";

export const AppliedTemplateSelectionSchema = z.strictObject({
  revision: z.int().min(1), templateRevision: z.string().min(1).max(256), userRevision: z.int().min(0),
  enrollmentRevision: z.int().min(1), request: HindsightTemplateApplyRequestSchema, receipt: HindsightTemplateReceiptSchema,
  snapshot: HindsightTemplateSnapshotSchema, projection: TemplateProjectionSchema,
  ownership: z.strictObject({ models: z.array(z.string()).max(64), directives: z.array(z.uuid()).max(64) }),
  committedAt: z.iso.datetime(),
});
export type AppliedTemplateSelection = z.infer<typeof AppliedTemplateSelectionSchema>;

export function verifyTemplateApplication(input: {
  preview: Pick<TemplatePreview, "request" | "projection">;
  receipt: HindsightTemplateReceipt; snapshot: HindsightTemplateSnapshot;
}): void {
  const request = signTemplateRequest(input.preview.request);
  if (request.request_hash !== input.preview.request.request_hash) invalid();
  verifyTemplateSnapshot(request.expected_snapshot);
  const receipt = normalizeHindsightTemplateReceipt(HindsightTemplateReceiptSchema.parse(input.receipt));
  const snapshot = verifyTemplateSnapshot(input.snapshot);
  const { receipt_hash: hash, ...body } = receipt;
  if (hash !== templateHash("receipt", body) || receipt.request_id !== request.request_id
    || receipt.request_hash !== request.request_hash || !templateEqual(receipt.target, request.target)
    || !templateEqual(snapshot.target, request.target) || receipt.before_snapshot_hash !== request.expected_snapshot.snapshot_hash
    || !templateEqual(receipt.changes, request.changes)
    || !validOriginalJournal(request, receipt)
    || !templateEqual(input.preview.projection, projectTemplateSnapshot(snapshot))) invalid();
  assertCurrentObjectProgress(request.expected_snapshot, snapshot);
  if (receipt.children.length !== request.refresh.length) invalid();
  const ids = new Set<string>();
  for (const child of receipt.children) {
    const expected = request.refresh.find((item) => item.child_id === child.child_id && item.model_id === child.model_id);
    const model = snapshot.models.find((item) => item.id === child.model_id);
    // Sync refresh may commit before Apply returns. Its current object proof can
    // advance while the original receipt retains the apply-time child identity.
    // This is definition admission only; Native still refuses old-child execution
    // on ANY revision/hash change, including an A -> B -> A definition race.
    if (!expected || ids.has(child.child_id) || model?.proof?.definition_hash !== child.definition_hash
      || model.proof.revision < child.object_revision
      || model.proof.revision === child.object_revision && model.proof.payload_hash !== child.object_payload_hash) invalid();
    ids.add(child.child_id);
  }
}

function validOriginalJournal(request: TemplatePreview["request"], receipt: HindsightTemplateReceipt): boolean {
  // Core previews contain only effective deltas. Refresh admission alone has no
  // logical event, and later refreshes cannot change this original receipt clock.
  const changed = Object.values(request.changes).some((items) => items.length > 0);
  return changed ? receipt.journal_after > receipt.journal_before : receipt.journal_after === receipt.journal_before;
}

function assertCurrentObjectProgress(expected: HindsightTemplateSnapshot, current: HindsightTemplateSnapshot): void {
  for (const kind of ["models", "directives"] as const) {
    for (const after of current[kind]) {
      const before = expected[kind].find((item) => item.id === after.id);
      if (!before?.proof || !after.proof) continue;
      // Definition-only updates advance Native's logical revision too. All
      // resources need this guard, even when the request admitted no refresh child.
      if (after.proof.revision < before.proof.revision || after.proof.revision === before.proof.revision
        && (after.proof.payload_hash !== before.proof.payload_hash || !templateEqual(after.definition, before.definition))) invalid();
    }
  }
}

export function deriveTemplateOwnership(previous: TemplateOwnership | null, request: TemplatePreview["request"]): TemplateOwnership {
  const models = new Set(previous?.models ?? []); const directives = new Set(previous?.directives ?? []);
  for (const item of request.changes.models) {
    if (item.kind === "delete") models.delete(item.id);
    else if (request.expected_snapshot.models.find((before) => before.id === item.definition.id)?.definition === null) models.add(item.definition.id);
  }
  for (const item of request.changes.directives) {
    if (item.kind === "delete") directives.delete(item.id);
    else if (request.expected_snapshot.directives.find((before) => before.id === item.definition.id)?.definition === null) directives.add(item.definition.id);
  }
  return { models: [...models].sort(), directives: [...directives].sort() };
}
function invalid(): never { throw new Error("HINDSIGHT_RESPONSE_INVALID"); }
