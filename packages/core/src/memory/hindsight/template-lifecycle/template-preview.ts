/**
 * INPUT:  reviewed enrollment, current coherent snapshot, independent user/template revisions and request UUIDs
 * OUTPUT: exact normalized Native request, effective projection and explicit deletion/provider-work consequences
 * POS:    Core B1 primitive; not in production runtime until B2, no I/O or model calls
 */
import { HindsightTemplateChangesSchema, type HindsightTemplateApplyRequest, type HindsightTemplateChanges,
  type HindsightTemplateSnapshot } from "@taki/shared";
import { TemplateCatalogEntrySchema, type TemplateCatalogEntry } from "./template-catalog.ts";
import { TemplateUserRevisionSchema, type TemplateUserRevision } from "./template-overlay-schema.ts";
import { enrollmentSelectors, selectTemplateResources, verifyTemplateEnrollment, type TemplateEnrollment } from "./template-enrollment.ts";
import { composeTemplateLabels } from "./template-label-composition.ts";
import { composeTemplateResources } from "./template-resource-composition.ts";
import { assertReviewedTemplateDrift } from "./template-drift.ts";
import { projectTemplateSnapshot, templateProjectionDigest, type TemplateProjection } from "./template-projection.ts";
import { signTemplateRequest, templateEqual, verifyTemplateSnapshot } from "./template-integrity.ts";

export interface TemplateOwnership {
  models: string[];
  directives: string[];
}
export interface TemplatePreview {
  request: HindsightTemplateApplyRequest;
  projection: TemplateProjection;
  effectiveDefinitionHash: string;
  templateRevision: string;
  userRevision: number;
  enrollmentRevision: number;
  consequences: {
    deletions: { kind: "model" | "directive"; id: string; historyCount: number; dependencyCount: number; hasGeneratedContent: boolean }[];
    providerWork: HindsightTemplateApplyRequest["refresh"];
  };
}
export interface TemplatePreviewInput {
  enrollment: TemplateEnrollment;
  snapshot: HindsightTemplateSnapshot;
  template: TemplateCatalogEntry | null;
  user: TemplateUserRevision;
  requestId: string;
  /** Last accepted definitions and receipt-proven creation identities, read from the overlay repository. */
  previous: { projection: TemplateProjection; ownership: TemplateOwnership } | null;
  /** Explicitly reviewed current state permits reconciliation; never supplied by a background retry. */
  reviewedDriftSnapshotHash?: string;
  refresh?: HindsightTemplateApplyRequest["refresh"];
  initialization?: HindsightTemplateApplyRequest["initialization"];
}

export function previewTemplateOverlay(input: TemplatePreviewInput): TemplatePreview {
  const enrollment = verifyTemplateEnrollment(input.enrollment);
  const snapshot = verifyTemplateSnapshot(input.snapshot);
  const user = TemplateUserRevisionSchema.parse(input.user);
  const template = input.template ? TemplateCatalogEntrySchema.parse(input.template) : null;
  if (!templateEqual(enrollment.identity.target, snapshot.target)
    || template && template.scope !== enrollment.identity.scope) conflict();
  const required = selectTemplateResources({ template, user, directiveIds: [], enrollment });
  if (!templateEqual(required, snapshot.selectors) || !templateEqual(required, enrollmentSelectors(enrollment))) conflict();
  assertNoDrift({ ...input, enrollment, snapshot });
  const projection: TemplateProjection = { ...projectTemplateSnapshot(snapshot),
    config: composeConfig({ enrollment, snapshot, template, user }),
    ...composeTemplateResources({ enrollment, snapshot, template, user }) };
  if (input.previous && input.reviewedDriftSnapshotHash === snapshot.snapshot_hash) {
    assertReviewedTemplateDrift({ previous: input.previous.projection, current: projectTemplateSnapshot(snapshot), desired: projection, user });
  }
  const changes = buildChanges({ enrollment, snapshot, projection, previous: input.previous });
  const refresh = input.refresh ?? [];
  if (refresh.some((item) => !projection.models.some((model) => model.id === item.model_id && model.definition))) conflict();
  const request = signTemplateRequest({ contract_version: "1.0.0", target: snapshot.target,
    request_id: input.requestId, request_hash: "0".repeat(64), expected_snapshot: snapshot, changes, refresh,
    initialization: input.initialization ?? null });
  return { request, projection, effectiveDefinitionHash: templateProjectionDigest(projection),
    templateRevision: template?.revision ?? "none", userRevision: user.revision, enrollmentRevision: enrollment.revision,
    consequences: { deletions: deletionConsequences(snapshot, changes), providerWork: structuredClone(request.refresh) } };
}

function assertNoDrift(input: TemplatePreviewInput): void {
  const actual = projectTemplateSnapshot(input.snapshot);
  assertCapturedEntries(input.enrollment, actual, input.previous?.projection);
  if (input.previous) {
    if (input.reviewedDriftSnapshotHash === input.snapshot.snapshot_hash) return;
    // New capture selectors may extend ownership, but every already accepted
    // definition and inherited parent value must still agree with that receipt.
    const prior = input.previous.projection;
    if (!templateEqual(prior.target, actual.target)) conflict();
    for (const key of ["config", "models", "directives"] as const) {
      const relevant = actual[key].filter((item) => prior[key].some((old) =>
        "key" in old && "key" in item ? old.key === item.key : "id" in old && "id" in item && old.id === item.id));
      if (!templateEqual(prior[key], relevant)) conflict();
    }
  }
}

function assertCapturedEntries(enrollment: TemplateEnrollment, actual: TemplateProjection, previous?: TemplateProjection): void {
  for (const key of ["config", "models", "directives"] as const) {
    const captured = enrollment.captures.flatMap<TemplateProjection["config" | "models" | "directives"][number]>(
      (capture) => projectTemplateSnapshot(capture.snapshot)[key]);
    for (const item of actual[key]) {
      const identity = "key" in item ? item.key : item.id;
      if (previous?.[key].some((entry) => ("key" in entry ? entry.key : entry.id) === identity)) continue;
      const original = captured.find((entry) => ("key" in entry ? entry.key : entry.id) === identity);
      if (!original || !templateEqual(original, item)) conflict();
    }
  }
}

function composeConfig(input: Pick<TemplatePreviewInput, "enrollment" | "snapshot" | "template" | "user">): TemplateProjection["config"] {
  return input.snapshot.config.map((current) => {
    const base = input.enrollment.captures.flatMap((capture) => capture.snapshot.config).find((item) => item.key === current.key);
    if (!base) return conflict();
    if (current.key === "entity_labels") return { ...current, stored: composeTemplateLabels({ base,
      inherited: current.inherited, template: input.template?.labelGroup ?? null, user: input.user.labels }) };
    const choice = input.user.config.find((item) => item.key === current.key)?.choice;
    // Empty text deliberately suppresses both inherited and Taki instructions;
    // inherit resets the user layer and reveals the current Taki/base selection.
    const value = choice?.mode === "value" ? choice.value : choice?.mode === "suppress" ? "" : input.template?.config[current.key];
    return { ...current, stored: value === undefined ? structuredClone(base.stored) : { kind: "value" as const, value } };
  });
}

function buildChanges(input: Pick<TemplatePreviewInput, "enrollment" | "snapshot" | "previous"> & { projection: TemplateProjection }): HindsightTemplateChanges {
  const { snapshot, projection } = input;
  const config = projection.config.filter((item, index) => !templateEqual(item.stored, snapshot.config[index]?.stored))
    .map(({ key, stored }) => ({ key, stored }));
  const models: HindsightTemplateChanges["models"] = [];
  const directives: HindsightTemplateChanges["directives"] = [];
  for (const desired of projection.models) {
    const before = snapshot.models.find((item) => item.id === desired.id);
    if (!before || templateEqual(before.definition, desired.definition)) continue;
    const original = input.enrollment.captures.flatMap((capture) => capture.snapshot.models).find((item) => item.id === desired.id);
    if (before.definition && !original?.definition && !input.previous?.ownership.models.includes(desired.id)) conflict();
    if (desired.definition) models.push({ kind: "upsert", definition: desired.definition });
    else {
      if (!before.proof || !input.previous?.ownership.models.includes(desired.id)
        || input.enrollment.captures.flatMap((capture) => capture.snapshot.models).find((item) => item.id === desired.id)?.definition) conflict();
      models.push({ kind: "delete", id: desired.id, deletion_hash: before.proof.deletion_hash });
    }
  }
  for (const desired of projection.directives) {
    const before = snapshot.directives.find((item) => item.id === desired.id);
    if (!before || templateEqual(before.definition, desired.definition)) continue;
    const original = input.enrollment.captures.flatMap((capture) => capture.snapshot.directives).find((item) => item.id === desired.id);
    if (before.definition && !original?.definition && !input.previous?.ownership.directives.includes(desired.id)) conflict();
    if (desired.definition) directives.push({ kind: "upsert", definition: desired.definition });
    else {
      if (!before.proof || !input.previous?.ownership.directives.includes(desired.id)
        || input.enrollment.captures.flatMap((capture) => capture.snapshot.directives).find((item) => item.id === desired.id)?.definition) conflict();
      directives.push({ kind: "delete", id: desired.id, deletion_hash: before.proof.deletion_hash });
    }
  }
  return HindsightTemplateChangesSchema.parse({ config, models, directives });
}

function deletionConsequences(snapshot: HindsightTemplateSnapshot, changes: HindsightTemplateChanges): TemplatePreview["consequences"]["deletions"] {
  return [...changes.models.filter((item) => item.kind === "delete").map((item) => ({ kind: "model" as const, id: item.id })),
    ...changes.directives.filter((item) => item.kind === "delete").map((item) => ({ kind: "directive" as const, id: item.id }))]
    .map((item) => {
      const state = (item.kind === "model" ? snapshot.models : snapshot.directives).find((entry) => entry.id === item.id);
      if (!state?.proof) return conflict();
      return { ...item, historyCount: state.proof.history_count, dependencyCount: state.proof.dependency_count,
        hasGeneratedContent: state.proof.has_generated_content };
    });
}
function conflict(): never { throw new Error("HINDSIGHT_TEMPLATE_CONFLICT"); }
