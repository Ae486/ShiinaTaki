/**
 * INPUT: isolated fixture acceptance/currentness/transport controls
 * OUTPUT: real Core accepted-source, Run/Attempt/Effect, Timeline and prepared-publication owners
 * POS: core/testing — producer and transport ports are local mocks; no real user data or external model calls
 */
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { ACCEPTED_WORK_PROVIDER, RunSnapshotSchema, type PreparedPublicationCandidate,
  type PreparedPublicationSource, type TriggerRequest } from "@taki/shared";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createRunDeliveryRepo } from "../db/run-delivery-repo.ts";
import { createRunService } from "../harness/run-service.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createDeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import { createPreparedPublication } from "../delivery/prepared-publication.ts";
import { createPreparedPublicationSource, type PreparedPublicationProducer,
  type PreparedPublicationSourceOwner } from "../delivery/prepared-publication-source.ts";
import { createPreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";
import { createTimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import { createCompanionFixture } from "./companion-fixture.ts";
import { createRunServiceStub } from "./run-service-stub.ts";

export async function preparedPublicationFixture(options: {
  hold?: boolean; sourceFactory?: (producer: PreparedPublicationProducer) => PreparedPublicationSourceOwner;
  /** Real-provider checks need an explicit finite lifetime longer than the deterministic one-minute default. */
  expiresAt?: string; provider?: string; modelId?: string;
  onPrimaryReserved?: (key: string) => void;
} = {}) {
  const base = createCompanionFixture(); const { db, memory } = base;
  const events = createRunEventRepo(db); const runRepo = createRunRepo(db, events);
  const effects = createEffectLifecycleService(createEffectRepo(db, events), runRepo.guardDispatch);
  const deliveries = createRunDeliveryRepo({ db, events }); const timeline = createTimelineRepo(db);
  const queue = createTurnQueue({ onPrimaryReserved: options.onPrimaryReserved }); const turns = createTurnRegistry(); const store = base.conversation;
  const flags = { authority: true, source: true, accepted: true, publicationAuthorized: true, gate: "ready" as "ready" | "hold" | "suppress",
    transport: "accepted" as "accepted" | "unknown" | "refused" };
  const hooks: { beforeCommit?: () => void } = {};
  const capture = vi.fn(async (request: TriggerRequest) => {
    const result = await createRunServiceStub().admit(request);
    return { snapshot: RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(result.snapshot),
      context: { authorityCurrent: () => flags.authority } };
  });
  const runs = createRunService({ repo: runRepo, snapshot: { capture }, provider: options.provider ?? "fixture", modelId: options.modelId ?? "fixture" });
  const subscriptions = createTimelineSubscriptions();
  const send = vi.fn(async () => flags.transport);
  subscriptions.subscribe("taki", { state: { status: "authenticated", deviceId: "fixture", role: "operator", capabilities: [] },
    notifyObserved: send }, { appended: () => undefined, removed: () => undefined });
  const delivery = createDeliveryCoordinator({ runs, repo: deliveries, queue, turns, store, subscriptions,
    busyMaxWaitMs: () => 90_000, policy: () => {
      hooks.beforeCommit?.();
      return { hourLimit: 0, dayLimit: 0, gapMs: 600_000, dayStart: new Date(Date.now() - 3_600_000).toISOString(), timezone: "UTC" };
    } });
  const id = randomUUID(); const expiresAt = options.expiresAt ?? new Date(Date.now() + 60_000).toISOString();
  const accepted: PreparedPublicationSource = { sourceRef: `report-source:${id}`, acceptanceRef: `explicit-report-request:${id}`,
    characterId: "taki", revision: "r1", expiresAt };
  const candidates = new Map<string, PreparedPublicationCandidate>([
    ["one", { candidateRef: "one", revision: "r1", text: "First prepared output.", expiresAt }],
    ["two", { candidateRef: "two", revision: "r1", text: "Second prepared output.", expiresAt }],
  ]);
  const producer = { readAccepted: () => flags.accepted ? accepted : undefined,
    resolve: ({ candidateRef }: { candidateRef: string }) => candidates.get(candidateRef),
    isCurrent: () => flags.source, gate: () => flags.gate };
  // Synthetic trusted classification for an explicitly requested non-media report, never from candidate JSON.
  const authorization = createPreparedPublicationAuthorization({ scope: {
    sourceRef: accepted.sourceRef, acceptanceRef: accepted.acceptanceRef, characterId: accepted.characterId,
    expiresAt, deliveryClass: "class_a",
  }, isCurrent: () => flags.publicationAuthorized });
  const source = options.sourceFactory?.(producer) ?? createPreparedPublicationSource(producer, authorization);
  const request: TriggerRequest = { triggerRequestId: id, idempotencyKey: id, characterId: "taki", initiator: "primary",
    provenance: { provider: ACCEPTED_WORK_PROVIDER, sourceRef: source.binding.sourceRef },
    deliveryClass: "internal", contextMode: "autonomous", deadlineAt: expiresAt };
  const root = await runs.admitAcceptedWork(request, source.binding); runs.start(root.run.runId, root.attempt.attemptId);
  const hold = () => runs.holdWork({ runId: root.run.runId, attemptId: root.attempt.attemptId,
    expectedRunVersion: runs.status(root.run.runId).run.stateVersion, reasonRef: source.binding.sourceRef });
  if (options.hold !== false) hold();
  const deps = { rootRunId: root.run.runId, source, runs, repo: deliveries, delivery, queue, turns };
  const owner = createPreparedPublication(deps);
  return { ...deps, db, memory, store, timeline, deliveries, runRepo, effects, events, capture, send, flags, hooks, accepted, candidates,
    producer, authorization, root, request, owner, hold, workspaceRoot: base.root,
    cleanup: () => { delivery.close(); base.cleanup(); } };
}
