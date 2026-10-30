/**
 * INPUT: existing connection, Perception, Timeline and durable Run event authorities
 * OUTPUT: one presence/feedback service, bounded deadline maintenance and primary-entry observation
 * POS: core/initiative — composition only; this lifecycle never wakes a model or acquires a sensor
 */
import type { TimelineEntry } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { RunEventRepo } from "../db/run-event-repo.ts";
import type { RunEventLiveBus } from "../db/run-event-live.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { PerceptionEvidence } from "../perception/perception-evidence.ts";
import type { Logger } from "../logging/logger.ts";
import { createPresenceEventBridge } from "../observability/presence-event-bridge.ts";
import { createInitiativeFeedbackRepo } from "../presence/initiative-feedback-repo.ts";
import { createPresenceService } from "../presence/presence-service.ts";
import { PRESENCE_RENEW_MS } from "../presence/presence-policy.ts";

export function composePresenceRuntime(input: {
  db: Database; events: RunEventRepo; live: RunEventLiveBus; connections: ConnectionRegistry;
  evidence: PerceptionEvidence; logger: Pick<Logger, "warn">; now?: () => number;
  onSourceChanged?: () => void;
}) {
  const now = input.now ?? Date.now;
  const feedback = createInitiativeFeedbackRepo({ db: input.db, now,
    ...createPresenceEventBridge({ events: input.events, live: input.live }) });
  const service = createPresenceService({ db: input.db, connections: input.connections, feedback, now,
    nativeEvidence: () => input.evidence.latest(now()), onSourceChanged: input.onSourceChanged });
  input.connections.onRemove((connection) => {
    const state = connection.state;
    if (state.status === "authenticated" && state.host) input.evidence.retireHost(state.host);
  });
  // Reconcile only durable publications/replies. No live lease survives this boot.
  service.sweep();
  const timer = setInterval(() => {
    try { service.sweep(); }
    catch { input.logger.warn({ code: "PRESENCE_MAINTENANCE_FAILED" }, "Presence feedback maintenance failed"); }
  }, PRESENCE_RENEW_MS);
  timer.unref();
  return {
    service,
    observeEntry(entry: TimelineEntry): void {
      if (entry.role !== "user") return;
      try { service.observeUserTurn(entry.characterId, entry.createdAt); }
      catch {
        // The user row is already durable. A later sweep reconciles that exact row; feedback
        // failure must not turn a successfully persisted foreground message into a send failure.
        input.logger.warn({ code: "PRESENCE_REPLY_OBSERVATION_FAILED" }, "Presence reply observation will be reconciled");
      }
    },
    close(): void { clearInterval(timer); service.close(); },
  };
}
