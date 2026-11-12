/**
 * INPUT: isolated test clock and optional event writer
 * OUTPUT: real SQLite Run/Attempt/Effect/Timeline/Delivery owners for focused lifecycle tests
 * POS: core/testing — no production source arrangement or network access
 */
import { randomUUID } from "node:crypto";
import { RunSnapshotSchema } from "@taki/shared";
import { openDatabase } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createRunDeliveryRepo } from "../db/run-delivery-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createRunService } from "../harness/run-service.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createConversationStore } from "../agents/conversation-store.ts";
import { createRunServiceStub } from "./run-service-stub.ts";

export function initiativeFixture(now?: () => string) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const events = createRunEventRepo(db); const runRepo = createRunRepo(db, events);
  const effects = createEffectLifecycleService(createEffectRepo(db, events), runRepo.guardDispatch);
  const runs = createRunService({ repo: runRepo, provider: "test", modelId: "test", snapshot: {
    async capture(request) {
      const old = await createRunServiceStub().admit(request);
      const snapshot = RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(old.snapshot);
      return { snapshot, context: {} };
    },
  } });
  const deliveries = createRunDeliveryRepo({ db, events, now });
  const timeline = createTimelineRepo(db); const store = createConversationStore({ repo: timeline });
  return { db, events, runRepo, effects, runs, deliveries, timeline, store,
    async admit(deliveryClass: "class_a" | "class_b" = "class_b") {
      const id = randomUUID(); const admitted = await runs.admit({ triggerRequestId: id, idempotencyKey: id,
        characterId: "taki", initiator: deliveryClass === "class_b" ? "heartbeat" : "scheduled",
        provenance: { provider: "test" }, deliveryClass, contextMode: "autonomous" });
      runs.start(admitted.run.runId, admitted.attempt.attemptId);
      return { runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, characterId: "taki", deliveryClass };
    },
  };
}
