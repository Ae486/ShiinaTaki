/**
 * INPUT: a retained accepted root, its original immutable snapshot and a candidate reference/revision
 * OUTPUT: a separate idempotent publication Run and synchronous currentness check without model admission
 * POS: core/harness — reuses RunRepo authority; parent lineage alone never authorizes publication
 */
import { randomUUID } from "node:crypto";
import {
  ACCEPTED_WORK_PROVIDER, PREPARED_PUBLICATION_PROVIDER, PreparedPublicationRunInputSchema,
  RunSnapshotSchema,
  type PreparedPublicationAuthorizationScope, type PreparedPublicationCandidate,
  type PreparedPublicationRunInput, type Run, type TriggerRequest,
} from "@taki/shared";
import type { RunAdmissionResult, RunRepo } from "../db/run-repo.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import type { RunExecutionContext } from "./run-service.ts";
import { preparedPublicationAuthority, workBindingRefusal } from "./run-work-binding.ts";

export interface PreparedPublicationAdmission extends RunAdmissionResult {
  readonly candidate: PreparedPublicationCandidate;
  /** Pure reads only: also invoked from the final SQLite publication transaction. */
  isCurrent(): boolean;
}
interface PreparedRunDeps {
  repo: RunRepo;
  context(runId: string): RunExecutionContext | undefined;
  isOpen(): boolean;
}

export function admitPreparedPublication(deps: PreparedRunDeps, input: PreparedPublicationRunInput): PreparedPublicationAdmission {
  const parsed = PreparedPublicationRunInputSchema.parse(input);
  const root = deps.repo.status(parsed.rootRunId).run;
  const retained = deps.context(root.runId);
  if (!rootCurrent(deps, root, retained)) throw new Error("PREPARED_ROOT_UNAVAILABLE");
  const publication = retained?.acceptedWork?.publication;
  const authorization = retained?.acceptedWork && preparedPublicationAuthority(retained.acceptedWork);
  if (!publication || !authorization || publication.characterId !== root.characterId) {
    throw new Error("PREPARED_SOURCE_UNAVAILABLE");
  }
  const candidate = publication.resolve({ candidateRef: parsed.candidateRef, expectedRevision: parsed.expectedRevision });
  if (!candidate || publication.isCurrent(candidate) !== true) throw new Error("PREPARED_REVISION_UNAVAILABLE");
  const request = publicationRequest(root, candidate, authorization.deliveryClass);
  const captured = deps.repo.snapshot(root.runId);
  const original = RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(captured);
  const snapshot = { ...original, characterId: request.characterId, initiator: request.initiator,
    provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode,
    contextDecision: { sourceCategories: ["prepared_output"], tokenAccounting: "unknown" as const },
    replayDecision: { status: "not_captured" as const }, budget: { deadlineAt: request.deadlineAt },
    sourceRefs: [captured.manifestDigest, digestRunValue(candidate)] };
  const admitted = deps.repo.admit({ runId: randomUUID(), request, snapshot,
    provider: original.modelProvider, modelId: original.modelId });
  return { ...admitted, candidate, isCurrent: () => {
    if (!rootCurrent(deps, root, retained)) return false;
    try { return publication.isCurrent(candidate) === true; } catch { return false; }
  } };
}

function rootCurrent(deps: PreparedRunDeps, admitted: Run, retained: RunExecutionContext | undefined): boolean {
  if (!deps.isOpen() || !retained || deps.context(admitted.runId) !== retained) return false;
  const root = deps.repo.status(admitted.runId).run;
  return root.provenance.provider === ACCEPTED_WORK_PROVIDER && root.deliveryClass === "internal"
    && ["running", "waiting"].includes(root.state) && root.activeAttemptId === admitted.activeAttemptId
    && root.characterId === admitted.characterId && root.provenance.sourceRef === admitted.provenance.sourceRef
    && (!root.deadlineAt || Date.now() < Date.parse(root.deadlineAt))
    && workBindingRefusal(retained, root.provenance.sourceRef) === undefined;
}

function publicationRequest(root: Run, candidate: PreparedPublicationCandidate,
  deliveryClass: PreparedPublicationAuthorizationScope["deliveryClass"]): TriggerRequest {
  const identity = `prepared:${digestRunValue([root.runId, candidate.candidateRef, candidate.revision])}`;
  return { triggerRequestId: identity, idempotencyKey: identity, characterId: root.characterId,
    initiator: "subagent", deliveryClass, contextMode: "autonomous",
    provenance: { provider: PREPARED_PUBLICATION_PROVIDER, parentRunId: root.runId,
      sourceRef: digestRunValue({ sourceRef: root.provenance.sourceRef, rootAttemptId: root.activeAttemptId, candidate }) },
    deadlineAt: new Date(Math.min(Date.parse(candidate.expiresAt), root.deadlineAt ? Date.parse(root.deadlineAt) : Infinity)).toISOString(),
    payloadRef: digestRunValue(candidate) };
}
