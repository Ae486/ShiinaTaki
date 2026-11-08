/**
 * INPUT:  verified replica/download bytes, durable prepared command bodies and the current Bank publication guard
 * OUTPUT: exact-ref cached bodies without native heads, artifacts, projections or checkpoint publication
 * POS:    core/db — immutable byte reuse only; complete snapshot/event proof still owns readable state
 */
import type { TakiApplicationBodyRef } from "@taki/shared";
import { sameApplicationValue, type HindsightApplicationBody } from "../memory/hindsight/hindsight-application-integrity.ts";
import { assertApplicationPublication } from "./hindsight-application-replica-checkpoint.ts";
import type { HindsightApplicationPublicationInput, HindsightApplicationReplicaState } from "./hindsight-application-replica-contract.ts";
import { readApplicationBody, saveApplicationBody } from "./hindsight-application-replica-evidence.ts";
import { readApplicationCommandBody } from "./hindsight-application-command-storage.ts";

export function readApplicationCachedBody(state: HindsightApplicationReplicaState,
  input: HindsightApplicationPublicationInput & { ref: TakiApplicationBodyRef }): HindsightApplicationBody | undefined {
  assertApplicationPublication(state, input);
  let body = readApplicationBody(state.db, { ...input, bodyId: input.ref.body_id });
  if (body && !sameApplicationValue(body.ref, input.ref)) throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
  if (!body) {
    const prepared = readApplicationCommandBody(state.db, { ...input, bodyId: input.ref.body_id });
    if (prepared && sameApplicationValue(prepared.ref, input.ref)) body = prepared;
  }
  assertApplicationPublication(state, input);
  return body;
}

export function saveApplicationCachedBodies(state: HindsightApplicationReplicaState,
  input: HindsightApplicationPublicationInput & { bodies: readonly HindsightApplicationBody[] }): void {
  // A completed body is useful across a bounded read retry, even when the rest
  // of that snapshot is unavailable. It is never sufficient native/application
  // evidence by itself, so only the immutable byte table is written here.
  state.db.transaction(() => {
    assertApplicationPublication(state, input);
    for (const body of input.bodies) saveApplicationBody(state.db, input, body);
    assertApplicationPublication(state, input);
  });
}
