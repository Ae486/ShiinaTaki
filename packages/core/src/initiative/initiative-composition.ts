/**
 * INPUT: existing Core authorities and one shared User Timezone service
 * OUTPUT: inert initiative adapter and Scheduled Class A result consumer
 * POS: core/initiative — composition only; no wake source, provider loop or production testing access
 */
import type { Database } from "../db/sqlite.ts";
import { createRunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { RunEventRepo } from "../db/run-event-repo.ts";
import type { RunEventLiveBus } from "../db/run-event-live.ts";
import type { RunService } from "../harness/run-service.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { ChatAgent } from "../agents/chat-agent.ts";
import type { ConversationStore } from "../agents/conversation-store.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { TimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import type { UserTimezoneService } from "../time/user-timezone-service.ts";
import type { ConfigSource } from "../config/config-source.ts";
import { createDeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import { createInitiativeRuntime } from "./initiative-runtime.ts";
import { captureInitiativePresentation } from "./initiative-presentation.ts";
import { createInitiativeOpportunityRepo } from "../db/initiative-opportunity-repo.ts";
import { readInitiativePolicy } from "../config/initiative-policy-config.ts";

export function composeInitiativeRuntime(input: {
  db: Database; events: RunEventRepo; live: RunEventLiveBus; runs: RunService; effects: EffectLifecycleService;
  agent: ChatAgent; queue: TurnQueue; turns: TurnRegistry; store: ConversationStore; subscriptions: TimelineSubscriptions;
  timezone: UserTimezoneService; config: ConfigSource;
  avatar: Omit<Parameters<typeof captureInitiativePresentation>[0], "characterId" | "effects">;
}) {
  const repo = createRunDeliveryRepo({ db: input.db, events: input.events, live: input.live });
  const policy = () => readInitiativePolicy(input.config);
  const delivery = createDeliveryCoordinator({ runs: input.runs, repo, queue: input.queue, turns: input.turns,
    store: input.store, subscriptions: input.subscriptions,
    busyMaxWaitMs: () => policy().busyMaxWaitMs,
    policy: () => ({ hourLimit: policy().utteranceHourLimit, dayLimit: policy().utteranceDayLimit,
      gapMs: policy().utteranceGapMs, dayStart: input.timezone.dayStart(), timezone: input.timezone.timezone() }) });
  const runtime = createInitiativeRuntime({ runs: input.runs, agent: input.agent, queue: input.queue,
    turns: input.turns, effects: input.effects, deliveries: repo, delivery,
    opportunities: createInitiativeOpportunityRepo(input.db), policy, timezoneRevision: () => input.timezone.read().revision,
    enabled: () => input.config.resolve("TAKI_INITIATIVE_ENABLED")?.value === true,
    authorityCurrent(context) {
      try { return context.memorySnapshot !== undefined && context.authorityCurrent?.() === true; }
      catch { return false; }
    },
    capturePresentation: (characterId) => captureInitiativePresentation({ ...input.avatar, characterId, effects: input.effects }),
  });
  return { runtime, policy: repo.policy, delivery, deliveries: repo,
    async finishScheduled(result: { runId: string; attemptId: string; characterId: string; text: string; signal?: AbortSignal }) {
      const record = repo.stage({ runId: result.runId, attemptId: result.attemptId, characterId: result.characterId,
        deliveryClass: "class_a", primaryVersion: input.queue.primaryVersion(result.characterId),
        expiresAt: new Date(Date.now() + policy().scheduledOutputTtlMs).toISOString(), consideredCount: 1,
        decision: { outcome: "speak", text: result.text.slice(0, 8_000), presentation: null,
          selectedCandidateIds: ["scheduled-result"], responseExpectation: "none" } });
      await delivery.finish(record, { isCurrent: () => !result.signal?.aborted, gate: () => "ready", present: async () => "failed" });
    },
  };
}
