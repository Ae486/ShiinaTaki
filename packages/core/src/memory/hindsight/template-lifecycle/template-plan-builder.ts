/**
 * INPUT:  one exact live Bank, operator choices and a bounded authenticated Native snapshot reader
 * OUTPUT: complete immutable before-images and a B1-composed Bank plan without persistence or provider work
 * POS:    Core preview construction — explicit enrollment is required for preexisting resource collisions
 */
import { randomUUID } from "node:crypto";
import { type MemoryTemplatePreviewParams, type MemoryTemplateUserRevision, type MemoryTemplateUserChoices, type HindsightTemplateSelectors } from "@taki/shared";
import type { Database } from "../../../db/sqlite.ts";
import type { HindsightCallContext, HindsightClient } from "../hindsight-client.ts";
import { loadManagedTemplate } from "./template-catalog.ts";
import { captureTemplateEnrollment, enrollmentSelectors, selectTemplateResources, type TemplateEnrollment } from "./template-enrollment.ts";
import { readTemplateEnrollment, readTemplateUser, readStoredTemplate } from "./template-overlay-history.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { emptyTemplateUserRevision } from "./template-overlay-schema.ts";
import { previewTemplateOverlay } from "./template-preview.ts";
import { TemplatePlanBankSchema, type TemplatePlanBank, type TemplatePlanGuard } from "./template-plan-schema.ts";
import { templateEqual } from "./template-integrity.ts";
import { withTemplatePreviewReview } from "./template-preview-conflict.ts";

export async function buildTemplatePlanBank(input: {
  db: Database; client: HindsightClient; request(): HindsightCallContext;
  bank: TemplatePlanGuard["banks"][number]; params: MemoryTemplatePreviewParams;
}): Promise<TemplatePlanBank> {
  const { identity, namespace } = input.bank; const target = input.params.target;
  const revision = target.kind === "bank" ? target.templateRevision
    : identity.scope === "global" ? target.globalTemplateRevision : target.characterTemplateRevision;
  const template = revision === "none" ? null : readStoredTemplate(input.db, { revision, scope: identity.scope }) ?? loadManagedTemplate(revision, identity.scope);
  const priorEnrollment = readTemplateEnrollment(input.db, identity);
  const priorUser = priorEnrollment ? readTemplateUser(input.db, identity) : null;
  const userPlan = userRevisions(priorUser, target.kind === "bank" ? target.userChoices : null);
  const previous = priorEnrollment ? readAppliedTemplateSelection(input.db, identity) : null;
  const directives = directiveSelectors({ enrollment: priorEnrollment, template,
    chosen: input.params.directives.find((item) => item.bankId === identity.target.bank_id)?.items ?? [] });
  const selectors = selectTemplateResources({ template, user: userPlan.user, directiveIds: directives, enrollment: priorEnrollment ?? undefined });
  // A fresh explicit-none selection still captures the real Native inheritance boundary and receives
  // its own no-op receipt. An empty selector set cannot establish any enrollment before-image.
  if (!template && !priorEnrollment) selectors.config_keys = ["retain_mission", "observations_instructions", "reflect_mission", "entity_labels"];
  if (!input.client.templateSnapshot) throw new Error("MEMORY_TEMPLATE_UNSUPPORTED");
  const snapshot = await input.client.templateSnapshot({ request: { contract_version: "1.0.0", target: identity.target, selectors }, context: input.request() });
  input.request();
  return withTemplatePreviewReview(snapshot, () => {
  const needsCapture = !priorEnrollment || !templateEqual(enrollmentSelectors(priorEnrollment), selectors);
  const enrollment = needsCapture ? captureTemplateEnrollment({ identity, snapshot, previous: priorEnrollment ?? undefined,
    mode: input.params.enrollment, reviewedSnapshotHash: input.params.enrollment === "reviewed-existing" ? snapshot.snapshot_hash : undefined }) : priorEnrollment;
  const refresh = input.params.refresh.find((item) => item.bankId === identity.target.bank_id)?.modelIds
    .map((model_id) => ({ model_id, child_id: randomUUID() })) ?? [];
  const preview = previewTemplateOverlay({ enrollment, snapshot, template, user: userPlan.user, previous, requestId: randomUUID(), refresh,
    reviewedDriftSnapshotHash: input.params.enrollment === "reviewed-existing" ? snapshot.snapshot_hash : undefined });
    return TemplatePlanBankSchema.parse({ identity, namespace, previousEnrollmentRevision: priorEnrollment?.revision ?? 0,
    previousUserRevision: priorUser?.revision ?? null, expectedSelectionRevision: previous?.revision ?? 0,
    enrollment, usersToAppend: userPlan.append, template, preview,
    summary: { target: identity.target, canonicalIdentity: identity.canonicalIdentity, scope: identity.scope,
      enrollment: priorEnrollment ? "managed" : input.params.enrollment, templateRevision: preview.templateRevision,
      userRevision: preview.userRevision, expectedSelectionRevision: previous?.revision ?? 0,
      snapshotHash: snapshot.snapshot_hash, effectiveDefinitionHash: preview.effectiveDefinitionHash,
      configChanges: preview.request.changes.config.length, modelChanges: preview.request.changes.models.length,
      directiveChanges: preview.request.changes.directives.length, deletions: preview.consequences.deletions.length,
      refreshChildren: preview.request.refresh.length } });
  });
}

function userRevisions(previous: MemoryTemplateUserRevision | null, choices: MemoryTemplateUserChoices | null) {
  const append: MemoryTemplateUserRevision[] = []; let user = previous ?? emptyTemplateUserRevision();
  if (!previous) append.push(user);
  if (choices) {
    const proposed = { ...choices, revision: user.revision + 1 };
    // A deliberate equal value remains explicit because the comparison is against the user document, not Native defaults.
    if (!templateEqual({ ...user, revision: 0 }, { ...proposed, revision: 0 })) { user = proposed; append.push(user); }
  }
  return { user, append };
}

function directiveSelectors(input: {
  enrollment: TemplateEnrollment | null; template: ReturnType<typeof loadManagedTemplate> | null;
  chosen: HindsightTemplateSelectors["directives"];
}): HindsightTemplateSelectors["directives"] {
  const result = input.enrollment ? [...enrollmentSelectors(input.enrollment).directives] : [];
  for (const item of input.chosen) {
    const prior = result.find((entry) => entry.name === item.name);
    if (prior && prior.id !== item.id) throw new Error("MEMORY_TEMPLATE_CONFLICT");
    if (!prior) result.push(item);
  }
  for (const directive of input.template?.directives ?? []) {
    if (!result.some((item) => item.name === directive.name)) result.push({ id: randomUUID(), name: directive.name });
  }
  return result;
}
