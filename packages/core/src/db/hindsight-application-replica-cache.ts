/**
 * INPUT:  verified replica/download bytes, durable prepared command bodies and the current Bank publication guard
 * OUTPUT: independently guarded single/batched exact-ref reads and immutable-byte saves without publication
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
  const body = readCachedBody(state, input);
  assertApplicationPublication(state, input);
  return body;
}

export function readApplicationCachedBodies(state: HindsightApplicationReplicaState,
  input: HindsightApplicationPublicationInput & { refs: readonly TakiApplicationBodyRef[] }): Map<string, HindsightApplicationBody> {
  const bodies = new Map<string, HindsightApplicationBody>();
  state.db.transaction(() => {
    assertApplicationPublication(state, input);
    for (const ref of input.refs) {
      const body = bodies.get(ref.body_id) ?? readCachedBody(state, { ...input, ref });
      if (body && !sameApplicationValue(body.ref, ref)) throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
      if (body) bodies.set(ref.body_id, body);
    }
    // Lease/deadline time can expire during a large synchronous byte read.
    assertApplicationPublication(state, input);
  });
  return bodies;
}

function readCachedBody(state: HindsightApplicationReplicaState,
  input: HindsightApplicationPublicationInput & { ref: TakiApplicationBodyRef }): HindsightApplicationBody | undefined {
  let body = readApplicationBody(state.db, { ...input, bodyId: input.ref.body_id });
  if (body && !sameApplicationValue(body.ref, input.ref)) throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
  if (!body) {
    const prepared = readApplicationCommandBody(state.db, { ...input, bodyId: input.ref.body_id });
    if (prepared && sameApplicationValue(prepared.ref, input.ref)) body = prepared;
  }
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
