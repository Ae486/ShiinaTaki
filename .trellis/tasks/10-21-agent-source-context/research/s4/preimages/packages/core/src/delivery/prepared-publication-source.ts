/**
 * INPUT: a trusted producer's accepted-source/candidate views and separately registered output authorization
 * OUTPUT: retained accepted-work binding with revision-closed publication and exact edit confirmation
 * POS: core/delivery — process-local authority binding only; Host/browser producers and IO remain external
 */
import { randomUUID } from "node:crypto";
import {
  PreparedPublicationCandidateSchema, PreparedPublicationEditSchema, PreparedPublicationSourceSchema,
  type PreparedPublicationCandidate, type PreparedPublicationEdit, type PreparedPublicationRequest,
  type PreparedPublicationSource,
} from "@taki/shared";
import type { AcceptedWorkBinding } from "../harness/run-work-binding.ts";
import { readPreparedPublicationAuthorization,
  type PreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";

export interface PreparedPublicationProducer {
  /** These ports read already accepted Core views synchronously, without IO, mutation, or implicit acceptance. */
  readAccepted(): unknown;
  resolve(input: PreparedPublicationRequest): unknown;
  isCurrent(): boolean;
  gate(candidate: PreparedPublicationCandidate): "ready" | "hold" | "suppress";
}
export interface PreparedPublicationSourceOwner {
  readonly binding: AcceptedWorkBinding;
  /** A binding has exactly one publication owner so cancellation handles cannot be lost through reattachment. */
  claim(): boolean;
  beginEdit(expectedRevision: string): PreparedPublicationEdit | undefined;
  confirmEdit(edit: PreparedPublicationEdit, revision: string): boolean;
  retire(): void;
}
interface SourceState {
  readonly accepted: PreparedPublicationSource;
  readonly authorization: PreparedPublicationAuthorization;
  revision: string;
  closed: boolean;
  retired: boolean;
  edit?: PreparedPublicationEdit;
  claimed?: boolean;
}

export function createPreparedPublicationSource(producer: PreparedPublicationProducer,
  authorization: PreparedPublicationAuthorization): PreparedPublicationSourceOwner {
  const accepted = PreparedPublicationSourceSchema.parse(producer.readAccepted());
  const state: SourceState = { accepted: Object.freeze(accepted), authorization, revision: accepted.revision, closed: false, retired: false };
  if (!sourceCurrent(producer, state)) throw new Error("PREPARED_SOURCE_UNAVAILABLE");
  const publication = Object.freeze({
    authorization, acceptanceRef: accepted.acceptanceRef, characterId: accepted.characterId, expiresAt: accepted.expiresAt,
    resolve: (input: PreparedPublicationRequest) => resolveCandidate(producer, state, input),
    isCurrent: (candidate: PreparedPublicationCandidate) => candidateCurrent(producer, state, candidate),
    gate: (candidate: PreparedPublicationCandidate) => {
      if (!candidateCurrent(producer, state, candidate)) return "suppress";
      try {
        const gate = producer.gate(candidate);
        return gate === "ready" || gate === "hold" ? gate : "suppress";
      } catch { return "suppress"; }
    },
  });
  return Object.freeze({
    binding: Object.freeze({ sourceRef: accepted.sourceRef, publication, isCurrent: () => sourceCurrent(producer, state) }),
    claim() { if (state.claimed || state.retired) return false; state.claimed = true; return true; },
    beginEdit(expectedRevision: string) {
      if (state.closed || !sourceCurrent(producer, state) || expectedRevision !== state.revision
        || PreparedPublicationSourceSchema.safeParse(producer.readAccepted()).data?.revision !== state.revision) return undefined;
      // Returning this ticket acknowledges Core gate closure. The caller retires pending children before Host IO.
      state.closed = true;
      state.edit = Object.freeze({ editId: randomUUID(), expectedRevision });
      return state.edit;
    },
    confirmEdit: (edit: PreparedPublicationEdit, revision: string) => confirmEdit(producer, state, { edit, revision }),
    retire() { state.retired = true; state.closed = true; state.edit = undefined; },
  });
}

function sourceCurrent(producer: PreparedPublicationProducer, state: SourceState): boolean {
  if (state.retired || !readPreparedPublicationAuthorization(state.authorization, state.accepted)) return false;
  try {
    const live = PreparedPublicationSourceSchema.safeParse(producer.readAccepted());
    return producer.isCurrent() === true && live.success && sameAcceptance(state.accepted, live.data);
  } catch { return false; }
}

function sameAcceptance(left: PreparedPublicationSource, right: PreparedPublicationSource): boolean {
  return left.sourceRef === right.sourceRef && left.acceptanceRef === right.acceptanceRef
    && left.characterId === right.characterId && left.expiresAt === right.expiresAt;
}

function resolveCandidate(producer: PreparedPublicationProducer, state: SourceState,
  input: PreparedPublicationRequest): PreparedPublicationCandidate | undefined {
  if (state.closed || !sourceCurrent(producer, state) || input.expectedRevision !== state.revision) return undefined;
  try {
    const live = PreparedPublicationSourceSchema.parse(producer.readAccepted());
    if (live.revision !== state.revision) return undefined;
    const result = PreparedPublicationCandidateSchema.safeParse(producer.resolve(input));
    if (!result.success || result.data.candidateRef !== input.candidateRef || result.data.revision !== input.expectedRevision
      || Date.now() >= Date.parse(result.data.expiresAt) || Date.parse(result.data.expiresAt) > Date.parse(state.accepted.expiresAt)) return undefined;
    return Object.freeze(result.data);
  } catch { return undefined; }
}

function candidateCurrent(producer: PreparedPublicationProducer, state: SourceState, candidate: PreparedPublicationCandidate): boolean {
  const live = resolveCandidate(producer, state, { candidateRef: candidate.candidateRef, expectedRevision: candidate.revision });
  return live !== undefined && live.text === candidate.text && live.expiresAt === candidate.expiresAt;
}

function confirmEdit(producer: PreparedPublicationProducer, state: SourceState,
  input: { edit: PreparedPublicationEdit; revision: string }): boolean {
  const parsed = PreparedPublicationEditSchema.safeParse(input.edit);
  if (!parsed.success || !state.closed || !state.edit || state.edit.editId !== parsed.data.editId
    || state.edit.expectedRevision !== parsed.data.expectedRevision || input.revision === state.revision
    || !sourceCurrent(producer, state)) return false;
  try {
    const live = PreparedPublicationSourceSchema.safeParse(producer.readAccepted());
    if (!live.success || live.data.revision !== input.revision) return false;
    state.revision = input.revision; state.edit = undefined; state.closed = false;
    return true;
  } catch { return false; }
}
