/** Diagnostic feedback loop: real Core preview/admission, tiny synthetic transport, no real pair. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHealthyTransitionHarness } from "../../../../packages/core/src/testing/memory-transition-healthy-fixtures.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../../../packages/core/src/db/canonical-memory-maintenance-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { readMemoryAuthoritySelection } from "../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";

for (const advanceClock of [true, false]) {
  test(`fresh reentry preview/admission with repeated-plan elapsed clock=${advanceClock}`, async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T00:00:00.000Z") });
    const h = await createHealthyTransitionHarness();
    try {
      const returned = h.owner.submit(await h.request()); await h.owner.stop();
      assert.equal(h.owner.status(returned.operationId).state, "completed");
      const epochId = readMemoryAuthoritySelection(h.db).epochId;
      const maintenance = createCanonicalMemoryMaintenanceRepo(h.db);
      const record = maintenance.list({ epochId, characterId: null })[0];
      maintenance.policyEdit({ epochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId, characterId: null,
        expectedRevision: record.unit.revision, requestId: "synthetic-stale-policy", now: h.clock.value,
        patch: { importance: record.policy.importance === 6 ? 7 : 6 } });
      createStructuredMemoryBlockRepo(h.db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
        content: "Synthetic changed Block.", actor: "user", expectedEpochId: epochId });
      // This calls the actual service.preview route over the tiny synthetic Native capability transport.
      const request = await h.request(undefined, "transition.reenter-hindsight");
      const before = h.db.prepare("SELECT count(*) n FROM memory_operations").get().n;
      const plan = h.service.plan; let plans = 0; let inner;
      h.service.plan = (value) => {
        plans++;
        try {
          const result = plan(value);
          if (advanceClock && plans === 1) h.clock.value = "2026-10-01T00:02:00.001Z";
          return result;
        } catch (error) { inner = error.stack; throw error; }
      };
      if (advanceClock) {
        assert.throws(() => h.owner.submit(request), /MEMORY_TRANSITION_STALE/);
        assert.equal(plans, 2);
        assert.match(inner, /assertTransitionPreviewRequest/);
        assert.match(inner, /persistAdmission/);
        assert.equal(h.db.prepare("SELECT count(*) n FROM memory_operations").get().n, before);
        assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_intents WHERE json_extract(intent_json,'$.request.kind')='transition.reenter-hindsight'").get().n, 0);
      } else {
        const entered = h.owner.submit(request); await h.owner.stop();
        assert.equal(plans, 2);
        assert.equal(h.owner.status(entered.operationId).state, "completed");
      }
    } finally { await h.close(); }
  });
}
