import { describe, expect, it } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { transitionOutcomeFixture } from "../testing/memory-transition-outcome-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { abortMemoryTransition } from "./memory-transition-abort.ts";
import { recordTransitionNativeOutcome } from "./memory-transition-native-outcome.ts";
import { enqueueTransitionWrite, readQueueOutcome, readTransitionQueue } from "./memory-transition-queue-repo.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { readTransitionAttempt } from "./memory-transition-repo.ts";

describe("positive native abort and queued source disposition", () => {
  it("requires every native Bank release before cancelling admitted writes and preserves source selection", async () => {
    const f = await createTransitionPublicationFixture({ beforeFence: async ({ db, intent }) => {
      const bank = intent.request.expected.banks[0]!;
      enqueueTransitionWrite(db, { now: W3_AT, admission: { transitionId: intent.transitionId,
        sourceEpochId: intent.request.expected.predecessorEpochId, callerRequestId: "original-caller",
        provenance: { callerId: "original", runId: null, attemptId: null, effectId: null }, scope: bank.scope,
        logicalTargetId: "unit-bank", expectedRevision: 1,
        command: { kind: "mutation", request: { kind: "edit", bankId: bank.sourceBankId,
          memoryId: "unit-bank", expectedRevision: 1, patch: { text: "never dispatched" } } } } });
    } });
    try {
      const marker = readMemoryAuthoritySelection(f.db); const queued = readTransitionQueue(f.db, f.intent.transitionId)[0]!;
      expect(() => abortMemoryTransition(f.db, f.input)).toThrow("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
      const statuses = f.proofs.map((proof) => transitionOutcomeFixture(proof.status, null));
      recordTransitionNativeOutcome(f.db, { ...f.input, status: statuses[0]! });
      expect(() => abortMemoryTransition(f.db, f.input)).toThrow("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
      expect(readQueueOutcome(f.db, queued.intentId)).toBeUndefined();
      recordTransitionNativeOutcome(f.db, { ...f.input, status: statuses[1]! });
      const resolution = abortMemoryTransition(f.db, f.input);
      expect(resolution.result).toMatchObject({ authorityCommitted: false, runtime: "source", queue: "settled", outcome: "cancelled" });
      expect(readQueueOutcome(f.db, queued.intentId)).toMatchObject({ status: "cancelled" });
      expect(readMemoryAuthoritySelection(f.db)).toEqual(marker);
      expect(abortMemoryTransition(f.db, f.input)).toEqual(resolution);
    } finally { await f.close(); }
  });

  it("cannot use a source abort after the authority receipt committed", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const receipt = publishMemoryTransition(f.db, f.prove());
      f.input.lease = readTransitionAttempt(f.db, f.intent.transitionId)!;
      expect(() => recordTransitionNativeOutcome(f.db, { ...f.input,
        status: transitionOutcomeFixture(f.proofs[0]!.status, null) })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => abortMemoryTransition(f.db, f.input)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(readMemoryAuthoritySelection(f.db).epochId).toBe(receipt.newEpochId);
    } finally { await f.close(); }
  });
});
