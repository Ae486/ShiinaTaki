/**
 * INPUT:  all fixed Bank receipts/readbacks and the live template executor plus synchronous final guards
 * OUTPUT: atomic selections/defaults/readiness/publication receipt/hold release, or a complete rollback
 * POS:    final Core template COMMIT — no Native I/O; binding occurs only after this transaction succeeds
 */
import { randomUUID } from "node:crypto";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../db/hindsight-connection-repo.ts";
import { createHindsightRuntimeAdmissionRepo } from "../../../db/hindsight-runtime-admission-repo.ts";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import type { Database } from "../../../db/sqlite.ts";
import type { HindsightCompatibilityWire } from "../hindsight-contracts.ts";
import { projectHindsightCompatibilityManifest } from "../hindsight-compatibility-service.ts";
import { publishTemplateDefaults } from "./template-default-store.ts";
import { readTemplatePublication, readTemplateHold } from "./template-execution-reads.ts";
import { templateEqual } from "./template-integrity.ts";
import { createTemplateOverlayStore } from "./template-overlay-store.ts";
import { publishedTemplateBankSetup } from "./template-plan-guard.ts";
import { TemplatePublicationSchema, type TemplatePlan, type TemplateObservation, type TemplatePublication } from "./template-plan-schema.ts";
import { readTemplateSelectionIdentity } from "./template-runtime-selection.ts";
import { assertSynchronousTemplateGuard, templateDocument, templateIdentityKey } from "./template-store-documents.ts";

export function publishTemplatePlan(db: Database, input: {
  plan: TemplatePlan; observations: TemplateObservation[]; manifest: HindsightCompatibilityWire; committedAt: string;
  assertExecutor(): void; assertCurrent(publication: TemplatePublication | null): void;
}): TemplatePublication {
  let result: TemplatePublication | null = null;
  db.transaction(() => {
    assertSynchronousTemplateGuard(() => input.assertCurrent(null));
    if (readTemplatePublication(db, input.plan.planId) || readTemplateHold(db, input.plan.planId)?.state !== "active") invalid();
    const selections = publishBanks(db, input);
    const defaultsRevision = publishDefaults(db, { ...input, selections });
    const connectionRevision = publishReadiness(db, input);
    const selectionIdentity = readTemplateSelectionIdentity(db, input.plan.guard.epochId);
    if (!selectionIdentity) invalid();
    const value = TemplatePublicationSchema.parse({ publicationId: randomUUID(), planId: input.plan.planId, planHash: input.plan.planHash,
      epochId: input.plan.guard.epochId, selections, defaultsRevision, connectionRevision, selectionIdentity, committedAt: input.committedAt });
    db.prepare("INSERT INTO hindsight_template_publications VALUES(:id,:plan,:identity,:hash,:json)")
      .run({ id: value.publicationId, plan: value.planId, identity: value.selectionIdentity, ...templateDocument(value) });
    if (db.prepare("UPDATE hindsight_template_holds SET state='published',publication_id=:publication WHERE plan_id=:plan AND state='active'")
      .run({ publication: value.publicationId, plan: value.planId }).changes !== 1) invalid();
    result = readTemplatePublication(db, value.planId);
    if (!templateEqual(result, value) || readTemplateHold(db, value.planId)?.publicationId !== value.publicationId) invalid();
    assertSynchronousTemplateGuard(() => input.assertCurrent(value));
    // This is deliberately after every synchronous readback, including caller guards (W9 final-deadline rule).
    assertSynchronousTemplateGuard(input.assertExecutor);
  });
  if (!result) invalid();
  return result;
}

function publishBanks(db: Database, input: Parameters<typeof publishTemplatePlan>[1]): TemplatePublication["selections"] {
  if (input.observations.length !== input.plan.banks.length) invalid();
  const store = createTemplateOverlayStore(db);
  return input.plan.banks.map((bank) => {
    const observations = input.observations.filter((item) => item.planId === input.plan.planId && item.bankKey === templateIdentityKey(bank.identity));
    if (observations.length !== 1) invalid();
    const observation = observations[0]!;
    const checkpoint = readApplicationCheckpoint(db, bank.identity.target.bank_id);
    if (!checkpoint || checkpoint.authorityEpochId !== input.plan.guard.epochId || checkpoint.bankDeleted
      || !templateEqual(checkpoint.namespace, bank.namespace) || checkpoint.checkpoint.native_cursor < observation.receipt.journal_after) invalid();
    const selected = store.publish({ identity: bank.identity, expectedSelectionRevision: bank.expectedSelectionRevision,
      preview: bank.preview, receipt: observation.receipt, snapshot: observation.snapshot,
      committedAt: input.committedAt, assertCurrent: input.assertExecutor });
    return { identity: bank.identity, revision: selected.revision, receiptHash: selected.receipt.receipt_hash };
  });
}
function publishDefaults(db: Database, input: Parameters<typeof publishTemplatePlan>[1] & { selections: TemplatePublication["selections"] }): number {
  const target = input.plan.params.target;
  if (target.kind !== "defaults") return input.plan.guard.defaultsRevision;
  if (input.plan.guard.banks.length !== input.plan.banks.length) invalid();
  const revision = input.plan.guard.defaultsRevision + 1;
  publishTemplateDefaults(db, { expectedRevision: input.plan.guard.defaultsRevision, assertCurrent: input.assertExecutor,
    value: { providerLineage: input.plan.guard.providerLineage, revision,
      globalTemplateRevision: target.globalTemplateRevision, characterTemplateRevision: target.characterTemplateRevision,
      banks: input.selections.map((selection) => ({ identity: selection.identity, selectionRevision: selection.revision, receiptHash: selection.receiptHash })) } });
  return revision;
}
function publishReadiness(db: Database, input: Parameters<typeof publishTemplatePlan>[1]): number {
  const banks = createHindsightBankSetupRepo(db);
  for (const entry of input.plan.guard.banks) {
    if (input.plan.banks.some((bank) => bank.identity.target.bank_id === entry.identity.target.bank_id)) {
      banks.upsert(publishedTemplateBankSetup(input.plan, entry.setup, input.committedAt));
    }
  }
  const connection = createHindsightConnectionRepo(db); const current = connection.read(banks.list());
  const revision = current.revision + 1;
  if (current.revision !== input.plan.guard.connectionRevision) invalid();
  connection.save({ ...current, revision, compatibility: projectHindsightCompatibilityManifest(input.manifest),
    latestError: null, lastSuccessAt: input.committedAt, updatedAt: input.committedAt }, current.revision);
  createHindsightRuntimeAdmissionRepo(db).save({ authorityEpochId: input.plan.guard.epochId,
    configFingerprint: input.plan.guard.configFingerprint, manifest: input.manifest, admittedAt: input.committedAt });
  return revision;
}
function invalid(): never { throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID"); }
