/**
 * INPUT:  real template lifecycle selections and independently generated complete Native W2 fixtures
 * OUTPUT: full healthy operation/runtime driver over the same Core SQLite for selected and removed overlays
 * POS:    integration fixture; Native transport is synthetic, Core candidate/publication/runtime owners are real
 */
import { createTemplateTransitionSource } from "./memory-transition-template-fixtures.ts";
import { templateTransitionEvidence, withTemplateAuxiliary } from "./memory-transition-template-evidence-fixtures.ts";
import { createHealthyTransitionTransport } from "./memory-transition-healthy-transport.ts";
import { composeHealthyTransitionHarness } from "./memory-transition-healthy-fixtures.ts";
import { templateObservationFixture } from "./hindsight-template-observation-fixtures.ts";
import { readApplicationCheckpoint } from "../db/hindsight-application-replica-checkpoint.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../db/hindsight-replica-checkpoint-store.ts";

export async function createTemplateHealthyHarness(removed = false) {
  const { fixture, refreshResults } = await createTemplateTransitionSource({ removed });
  try {
    fixture.service.stop(); await fixture.owner.stop();
    // The general B2 fixture advances only its application-side cursor. Complete
    // Healthy publication needs the independent v1 checkpoint paired as well.
    fixture.db.transaction(() => {
      for (const bank of fixture.bindings) {
        const checkpoint = readApplicationCheckpoint(fixture.db, bank.externalBankId);
        if (!checkpoint) throw new Error("complete Healthy fixture checkpoint missing");
        publishReplicaCheckpoint(fixture.db, { previous: readReplicaCheckpoint(fixture.db, bank.externalBankId) ?? null, next: checkpoint.native });
      }
    });
    const initial = templateTransitionEvidence(fixture, refreshResults);
    const remote = createHealthyTransitionTransport(initial, fixture.db);
    Object.assign(remote.manifest, structuredClone(fixture.native.manifest));
    const observer = templateObservationFixture(fixture.native, refreshResults);
    for (const value of initial) observer.cursors.set(value.status.bank_id, value.status.proof!.native_snapshot.manifest.end_cursor);
    Object.assign(remote.client, observer.client);
    const applyDelta = remote.client.applyTransitionDelta!;
    remote.client.applyTransitionDelta = async (input) => {
      const result = await applyDelta(input);
      const key = JSON.stringify([input.bankId, input.request.executor.transition_id]);
      const evidence = remote.evidence.get(key);
      if (!evidence) throw new Error("post-delta Healthy fixture evidence missing");
      // The generic delta fixture rebuilds ordinary Native rows. This specialized
      // transport also carries the independently held template receipts/results,
      // which real Native includes in its final auxiliary snapshot after delta.
      // Reseal before the proof is observed; never rewrite persisted Core evidence.
      const complete = withTemplateAuxiliary(evidence, fixture, refreshResults);
      remote.evidence.set(key, complete);
      observer.cursors.set(input.bankId, complete.status.proof!.native_snapshot.manifest.end_cursor);
      return result;
    };
    const clock = { value: fixture.state.now };
    const composed = composeHealthyTransitionHarness({ db: fixture.db, dataDir: fixture.base.dataDir,
      timeline: fixture.base.timeline, remote, clock, fingerprint: fixture.live.configFingerprint });
    return { fixture, db: fixture.db, initial, remote, observer, clock, ...composed,
      close: async () => { await composed.stop(); await fixture.close(); } };
  } catch (error) { await fixture.close(); throw error; }
}
