import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { withTransitionObservationContext, type TransitionEvidenceContext } from "./transition-evidence-context.ts";
import { TransitionObservationStore } from "./transition-observation-store.ts";
import { projectTransitionLocalBank } from "./transition-local-projection.ts";
import { readTransitionLocalAncestors } from "../../db/memory-transition-candidate-repo.ts";
import { openDatabase } from "../../db/sqlite.ts";
import * as native from "./transition-native-evidence.ts";

afterEach(() => vi.restoreAllMocks());
describe("observation artifact scope", () => {
  it("freezes pure outputs, includes future arguments in identity and replaces obsolete variants", async () => {
    const f = await createTransitionPublicationFixture(); const store = new TransitionObservationStore(f.db);
    try {
      const run = (future: number) => withTransitionObservationContext({ db: f.db, receiptId: "owned-receipt", store }, (verification) => {
        const evidence = verification.read(f.db, f.proofs[0]!.evidenceId);
        return projectTransitionLocalBank({ evidence, scope: f.candidate.scopes[0]!, epochId: f.candidate.targetEpochId,
          createdAt: f.candidate.createdAt, localEpochIds: readTransitionLocalAncestors(f.db, f.candidate.predecessorEpochId),
          ...{ futureSemanticField: future }, verification });
      });
      const first = run(1); expect(run(1)).toBe(first);
      expect(() => first.records.pop()).toThrow(); expect(() => { first.bank.name = "corrupted"; }).toThrow();
      const changed = run(2); expect(changed).not.toBe(first); expect(changed).toEqual(first);
      // Returning to the old key recomputes: only the latest variant is retained for this Bank.
      const restored = run(1); expect(restored).not.toBe(first); expect(restored).toEqual(first);
    } finally { store.close(); await f.close(); }
  });

  it("prunes unused dependencies, resets a changed receipt and rejects foreign Database or closed scope", async () => {
    const f = await createTransitionPublicationFixture(); const store = new TransitionObservationStore(f.db);
    const foreign = openDatabase({ path: ":memory:", migrations: [] });
    try {
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      const run = (receiptId: string, ids: string[]) => withTransitionObservationContext({ db: f.db, receiptId, store },
        (context) => ids.map((id) => context.read(f.db, id)));
      const ids = f.proofs.map((row) => row.evidenceId);
      run("first", ids); expect(verify).toHaveBeenCalledTimes(ids.length); verify.mockClear();
      run("first", [ids[0]!]); expect(verify).not.toHaveBeenCalled();
      run("first", [ids[1]!]); expect(verify).toHaveBeenCalledOnce(); verify.mockClear();
      run("second", [ids[1]!]); expect(verify).toHaveBeenCalledOnce();
      expect(() => withTransitionObservationContext({ db: foreign, receiptId: "second", store }, () => undefined)).toThrow();
      store.close(); expect(() => run("second", ids)).toThrow();
    } finally { store.close(); foreign.close(); await f.close(); }
  });

  it("never shares mutable body bytes or accepts foreign envelopes, expired contexts or asynchronous validation", async () => {
    const f = await createTransitionPublicationFixture(); const store = new TransitionObservationStore(f.db);
    let escaped: TransitionEvidenceContext | undefined;
    try {
      let original: Uint8Array | undefined; let bodyId: string | undefined;
      const request = { db: f.db, receiptId: "owned-receipt", store };
      withTransitionObservationContext(request, (context) => {
        escaped = context; const evidence = context.read(f.db, f.proofs[0]!.evidenceId);
        expect(() => context.bundle(structuredClone(evidence))).toThrow();
        const body = [...context.bundle(evidence).bodies.values()][0]!;
        original = Uint8Array.from(body.bytes); bodyId = body.ref.body_id; body.bytes.fill(0);
      });
      expect(() => escaped!.read(f.db, f.proofs[0]!.evidenceId)).toThrow();
      withTransitionObservationContext(request, (context) => {
        const evidence = context.read(f.db, f.proofs[0]!.evidenceId);
        expect(context.bundle(evidence).bodies.get(bodyId!)!.bytes).toEqual(original);
      });
      expect(() => withTransitionObservationContext(request, () => Promise.resolve())).toThrow();
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      withTransitionObservationContext(request, (context) => context.read(f.db, f.proofs[0]!.evidenceId));
      expect(verify).toHaveBeenCalledOnce();
    } finally { store.close(); await f.close(); }
  });
});
