import { describe, expect, it } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { commitTransitionStage, completeTransitionStage, reenterTransitionStage } from "../testing/memory-transition-cycle-fixtures.ts";
import { transitionOutcomeFixture } from "../testing/memory-transition-outcome-fixtures.ts";
import { abortMemoryTransition } from "./memory-transition-abort.ts";
import { recordTransitionNativeOutcome, readTransitionNativeRelease, requireTransitionTargetReady } from "./memory-transition-native-outcome.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";

describe("new native scope finalization", () => {
  it.each(["abort", "activate"] as const)("rejects a valid %s outcome stored under another Bank's key", async (action) => {
    const f = await createTransitionPublicationFixture();
    try {
      const source = commitTransitionStage(f); completeTransitionStage(f, source);
      const stage = reenterTransitionStage(f, source, true);
      const receipt = action === "activate" ? commitTransitionStage(stage) : null;
      const outcomes = stage.proofs.map((proof) => transitionOutcomeFixture(proof.status, receipt?.receiptId ?? null));
      for (const status of outcomes) recordTransitionNativeOutcome(f.db, { ...stage.input, status });
      f.db.exec("DROP TRIGGER memory_transition_native_outcomes_no_update");
      f.db.prepare("UPDATE memory_transition_native_outcomes SET status_json=:json WHERE transition_id=:transition AND bank_id=:bank")
        .run({ transition: stage.intent.transitionId, bank: outcomes[1]!.bank_id, json: JSON.stringify(outcomes[0]) });
      expect(() => readTransitionNativeRelease(f.db, stage.input)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      if (receipt) expect(() => requireTransitionTargetReady(f.db, receipt.newEpochId)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      else expect(() => abortMemoryTransition(f.db, stage.input)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { await f.close(); }
  }, 20_000);

  it.each(["abort", "activate"] as const)("requires the exact unused Bank %s proof alongside every existing Bank", async (action) => {
    const f = await createTransitionPublicationFixture();
    try {
      const source = commitTransitionStage(f); completeTransitionStage(f, source);
      const stage = reenterTransitionStage(f, source, true);
      expect(stage.candidate.scopes.find((scope) => scope.nativeBankId === "new-native-bank")?.origin).toBe("new");
      const receipt = action === "activate" ? commitTransitionStage(stage) : null;
      const expectedEpoch = receipt?.newEpochId ?? source.newEpochId;
      const outcomes = stage.proofs.map((proof) => transitionOutcomeFixture(proof.status, receipt?.receiptId ?? null));
      for (const status of outcomes.filter((row) => row.bank_id !== "new-native-bank")) recordTransitionNativeOutcome(f.db, { ...stage.input, status });
      const verify = () => receipt ? requireTransitionTargetReady(f.db, receipt.newEpochId) : abortMemoryTransition(f.db, stage.input);
      expect(verify).toThrow("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
      const unused = outcomes.find((row) => row.bank_id === "new-native-bank")!;
      expect(unused.phase).toBe(receipt ? "active" : "quarantined");
      const foreign = structuredClone(unused); foreign.request.unused_scope!.bank_generation = "11111111-1111-4111-8111-111111111111";
      expect(() => recordTransitionNativeOutcome(f.db, { ...stage.input, status: foreign })).toThrow();
      recordTransitionNativeOutcome(f.db, { ...stage.input, status: unused });
      expect(() => f.db.exec("INSERT OR REPLACE INTO memory_transition_native_outcomes SELECT * FROM memory_transition_native_outcomes")).toThrow("immutable");
      expect(() => readTransitionNativeRelease(f.db, stage.input)).not.toThrow();
      expect(verify).not.toThrow(); expect(readMemoryAuthoritySelection(f.db).epochId).toBe(expectedEpoch);
    } finally { await f.close(); }
  }, 20_000);
});
