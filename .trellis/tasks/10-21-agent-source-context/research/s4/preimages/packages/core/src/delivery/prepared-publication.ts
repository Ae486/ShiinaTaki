/**
 * INPUT: one explicitly bound accepted root and reference-only candidate publication/edit requests
 * OUTPUT: existing Run/Delivery composition, scoped Stop and gate-before-edit acknowledgement
 * POS: core/delivery — inert trusted adapter; no model loop, scheduler, Host IO or independent execution ledger
 */
import {
  ACCEPTED_WORK_PROVIDER, PreparedPublicationRequestSchema, type DeliveryRecord,
  type PreparedPublicationEdit, type PreparedPublicationRequest, type PreparedPublicationResult,
} from "@taki/shared";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { PreparedPublicationAdmission } from "../harness/run-prepared-publication.ts";
import type { RunService } from "../harness/run-service.ts";
import { workBindingRefusal, type AcceptedWorkBinding } from "../harness/run-work-binding.ts";
import type { DeliveryBinding, DeliveryCoordinator } from "./delivery-coordinator.ts";
import type { PreparedPublicationSourceOwner } from "./prepared-publication-source.ts";

export interface PreparedPublicationOwner {
  publish(input: PreparedPublicationRequest): Promise<PreparedPublicationResult>;
  beginEdit(expectedRevision: string): PreparedPublicationEdit | undefined;
  confirmEdit(edit: PreparedPublicationEdit, revision: string): boolean;
  stop(): void;
}
interface PreparedDeps {
  rootRunId: string; source: PreparedPublicationSourceOwner; runs: RunService; repo: RunDeliveryRepo;
  delivery: DeliveryCoordinator; queue: TurnQueue; turns: TurnRegistry;
}
interface BoundPreparedDeps extends PreparedDeps {
  publication: NonNullable<AcceptedWorkBinding["publication"]>;
}
interface PreparedState {
  closed: boolean;
  // Retained cancellation/currentness handles only. All execution and delivery state is read from existing owners.
  children: Map<string, PreparedPublicationAdmission>;
  edit?: PreparedPublicationEdit;
}

export function createPreparedPublication(input: PreparedDeps): PreparedPublicationOwner {
  const publication = input.source.binding.publication;
  if (!publication) throw new Error("PREPARED_ROOT_UNAVAILABLE");
  const deps: BoundPreparedDeps = { ...input, publication };
  if (!rootCurrent(deps) || !deps.source.claim()) throw new Error("PREPARED_ROOT_UNAVAILABLE");
  const state: PreparedState = { closed: false, children: new Map() };
  return {
    publish: (input) => publish(deps, state, input),
    beginEdit(expectedRevision) {
      if (state.closed || !rootCurrent(deps)) return undefined;
      const edit = state.edit ?? deps.source.beginEdit(expectedRevision);
      if (!edit || edit.expectedRevision !== expectedRevision) return undefined;
      state.edit = edit;
      // A failed retirement leaves the gate closed and this ticket retained for an explicit retry; Host IO cannot start.
      retireChildren(deps, state);
      return edit;
    },
    confirmEdit(edit, revision) {
      if (state.closed || !rootCurrent(deps) || state.edit?.editId !== edit.editId) return false;
      retireChildren(deps, state);
      if (!deps.source.confirmEdit(edit, revision)) return false;
      state.edit = undefined; return true;
    },
    stop: () => stop(deps, state),
  };
}

async function publish(deps: BoundPreparedDeps, state: PreparedState, input: PreparedPublicationRequest): Promise<PreparedPublicationResult> {
  const parsed = PreparedPublicationRequestSchema.safeParse(input);
  if (!parsed.success) return { status: "refused", reason: "invalid_input" };
  // A later plan revision is not a replay grant for an output whose transport may already have accepted it.
  const committed = committedOutput(deps, state, parsed.data);
  if (committed) return committed;
  if (state.closed) return { status: "refused", reason: "closed" };
  if (!rootCurrent(deps)) return { status: "refused", reason: "root_unavailable" };
  const release = deps.queue.tryAcquireBackground(deps.publication.characterId);
  if (!release) return { status: "deferred", reason: "foreground_busy" };
  try { return await publishInLane(deps, state, parsed.data); }
  finally { release(); }
}

async function publishInLane(deps: BoundPreparedDeps, state: PreparedState, input: PreparedPublicationRequest): Promise<PreparedPublicationResult> {
  const publication = deps.publication;
  const candidate = publication.resolve(input);
  if (!candidate) return { status: "refused", reason: "revision_unavailable" };
  const key = JSON.stringify([input.candidateRef, input.expectedRevision]);
  const retained = state.children.get(key);
  const held = deps.repo.held(publication.characterId);
  if (publication.gate(candidate) === "hold" && held && held.runId !== retained?.run.runId) {
    return { status: "deferred", reason: "held_slot_busy" };
  }
  let admitted: PreparedPublicationAdmission;
  try { admitted = retained ?? deps.runs.admitPreparedPublication({ rootRunId: deps.rootRunId, ...input }); }
  catch (error) { return admissionRefusal(error); }
  state.children.set(key, admitted);
  const expiresAt = admitted.run.deadlineAt;
  if (!expiresAt || admitted.run.deliveryClass !== "class_a" || !admitted.isCurrent()) {
    retireChild(deps, admitted);
    return { status: "refused", reason: "source_unavailable" };
  }
  const runId = admitted.run.runId; const attemptId = admitted.attempt.attemptId;
  const existing = deps.repo.get(runId);
  if (existing && !["staged", "held"].includes(existing.state)) return recorded(existing);
  const status = deps.runs.status(runId);
  if (!existing && status.run.state === "queued") deps.runs.start(runId, attemptId);
  if (!existing && deps.runs.status(runId).run.state !== "running") return { status: "refused", reason: "source_unavailable" };
  const record = existing ?? deps.repo.stage({ runId, attemptId, characterId: admitted.run.characterId, deliveryClass: admitted.run.deliveryClass,
    decision: { outcome: "speak", text: admitted.candidate.text, selectedCandidateIds: [admitted.candidate.candidateRef],
      presentation: null, responseExpectation: "none" }, expiresAt,
    primaryVersion: deps.queue.primaryVersion(admitted.run.characterId), consideredCount: 1 });
  const controller = deps.turns.begin(admitted.run.characterId, undefined, runId);
  try { await deps.delivery.finish(record, deliveryBinding(deps, admitted)); }
  finally { deps.turns.end(admitted.run.characterId, controller); }
  return recorded(deps.repo.get(runId) ?? record);
}

function deliveryBinding(deps: BoundPreparedDeps, admitted: PreparedPublicationAdmission): DeliveryBinding {
  return {
    isCurrent: admitted.isCurrent,
    gate: () => deps.publication.gate(admitted.candidate),
    publicationCurrent: (record) => record.runId === admitted.run.runId && record.attemptId === admitted.attempt.attemptId
      && record.decision.outcome === "speak" && record.decision.text === admitted.candidate.text
      && record.decision.selectedCandidateIds.length === 1 && record.decision.selectedCandidateIds[0] === admitted.candidate.candidateRef
      && record.decision.presentation === null && record.decision.responseExpectation === "none" && admitted.isCurrent(),
    // This entry admits only trusted exact text. Presentation remains on its existing governed Effect path.
    present: () => Promise.resolve("failed"),
  };
}

function rootCurrent(deps: BoundPreparedDeps): boolean {
  const root = deps.runs.status(deps.rootRunId).run; const retained = deps.runs.context(deps.rootRunId);
  return root.provenance.provider === ACCEPTED_WORK_PROVIDER && root.deliveryClass === "internal"
    && ["running", "waiting"].includes(root.state) && retained?.acceptedWork === deps.source.binding
    && deps.source.binding.publication === deps.publication && (!root.deadlineAt || Date.now() < Date.parse(root.deadlineAt))
    && workBindingRefusal(retained, root.provenance.sourceRef) === undefined;
}

function committedOutput(deps: PreparedDeps, state: PreparedState, input: PreparedPublicationRequest): PreparedPublicationResult | undefined {
  for (const child of state.children.values()) {
    if (child.candidate.candidateRef !== input.candidateRef) continue;
    const record = deps.repo.get(child.run.runId);
    if (record && ["dispatch_committed", "sent", "unknown", "no_target"].includes(record.state)) {
      return child.candidate.revision === input.expectedRevision ? recorded(record) : { status: "refused", reason: "output_committed" };
    }
  }
  return undefined;
}

function recorded(record: DeliveryRecord): PreparedPublicationResult {
  return { status: "recorded", runId: record.runId, deliveryId: record.deliveryId, state: record.state };
}

function admissionRefusal(error: unknown): PreparedPublicationResult {
  if (error instanceof Error) {
    if (error.message === "PREPARED_ROOT_UNAVAILABLE") return { status: "refused", reason: "root_unavailable" };
    if (error.message === "PREPARED_SOURCE_UNAVAILABLE") return { status: "refused", reason: "source_unavailable" };
    if (error.message === "PREPARED_REVISION_UNAVAILABLE") return { status: "refused", reason: "revision_unavailable" };
  }
  throw error;
}

function retireChildren(deps: PreparedDeps, state: PreparedState): void {
  const failures: unknown[] = [];
  for (const child of state.children.values()) {
    try { retireChild(deps, child); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "PREPARED_RETIREMENT_FAILED");
}

function retireChild(deps: PreparedDeps, child: PreparedPublicationAdmission): void {
  if (deps.repo.get(child.run.runId)) { deps.delivery.retireRun(child.run.runId); return; }
  const run = deps.runs.status(child.run.runId).run;
  if (!["queued", "running", "cancel_requested"].includes(run.state) || run.activeAttemptId !== child.attempt.attemptId) return;
  // An admitted text child with no staged delivery has dispatched neither transport nor a model/Tool Effect.
  deps.runs.requestCancel(run.runId, "prepared output retired before staging");
  deps.runs.settle(run.runId, child.attempt.attemptId, "cancelled", { retryable: false });
}

function stop(deps: PreparedDeps, state: PreparedState): void {
  state.closed = true; deps.source.retire();
  // Closure precedes every durable control write. Even a failed write cannot let a late callback publish.
  const root = deps.runs.status(deps.rootRunId).run;
  deps.runs.requestCancel(root.runId, "accepted work stopped");
  deps.turns.cancel(root.characterId, root.runId);
  try { retireChildren(deps, state); }
  finally {
    // C1 waiting guarantees there is no unfinished Effect. Running work keeps its actual settlement owner.
    if (root.state === "waiting" && root.activeAttemptId) {
      deps.runs.settle(root.runId, root.activeAttemptId, "cancelled", { retryable: false });
    }
  }
}
