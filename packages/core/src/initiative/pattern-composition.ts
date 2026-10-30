/**
 * INPUT: actual Core source/config/Memory/Run owners and the single explicit initiative target
 * OUTPUT: C3 setup, typed invalidations and finite wake lifecycle feeding the C1 runtime
 * POS: core/initiative — composition only; no substitute provider loop, Run ledger or source acquisition
 */
import { INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS, INTERACTION_PATTERN_METHODS,
  INITIATIVE_BACKOFF_METHODS, type RunEvent } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { createInitiativeCompletionSource } from "../db/initiative-completion-source.ts";
import type { ConfigSource } from "../config/config-source.ts";
import { readInitiativePolicy } from "../config/initiative-policy-config.ts";
import { readInitiativeWakePolicy } from "../config/initiative-wake-config.ts";
import type { UserTimezoneService } from "../time/user-timezone-service.ts";
import type { PerceptionLayer } from "../perception/perception-layer.ts";
import { renderScreenContext } from "../perception/screen-context.ts";
import type { PresenceService } from "../presence/presence-service.ts";
import type { CapturedMemoryRun } from "../memory/canonical-memory-run.ts";
import type { SkillLifecycleService } from "../skills/skill-lifecycle-service.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { Logger } from "../logging/logger.ts";
import { registerInteractionPatternMethods } from "../server/methods/interaction-pattern-methods.ts";
import { registerInitiativeSetupMethods } from "../server/methods/initiative-setup-methods.ts";
import type { InteractionPatternService } from "./patterns/pattern-service.ts";
import { createInitiativeContextBuilder } from "./initiative-context-builder.ts";
import { createInitiativeSetup, initiativeTarget } from "./initiative-setup.ts";
import { createAuthoringSkillSetup } from "./authoring-skill.ts";
import { createInitiativeWakeEngine } from "./wake/wake-engine.ts";
import { wakeDigest } from "./wake/wake-matcher.ts";
import type { InitiativeWakeSnapshot } from "./wake/wake-contract.ts";
import type { InitiativeRuntime } from "./initiative-runtime.ts";
import type { IntentionService } from "./intentions/intention-service.ts";
import { createInitiativeBackoff } from "./backoff/initiative-backoff.ts";
import { registerInitiativeBackoffMethods } from "../server/methods/initiative-backoff-methods.ts";
import type { ViewingInvitationSource } from "../co-watching/viewing-invitation-source.ts";

interface Dependencies {
  db: Database; config: ConfigSource; timezone: UserTimezoneService; perception: PerceptionLayer; presence: PresenceService;
  skills: SkillLifecycleService; patterns: InteractionPatternService; connections: ConnectionRegistry; registry: MethodRegistry;
  queue: TurnQueue; turns: TurnRegistry; runtime: InitiativeRuntime; logger: Pick<Logger, "warn">;
  intentions: IntentionService;
  viewing?: ViewingInvitationSource;
  captureMemory(characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun>;
  avatarContext(characterId: string): string;
  targetReady(characterId: string): boolean;
  monitorEnabled(): boolean;
}

export function composePatternRuntime(input: Dependencies) {
  const completions = createInitiativeCompletionSource(input.db);
  const context = createInitiativeContextBuilder({ captureMemory: input.captureMemory,
    avatarContext: input.avatarContext, screenContext: (at) => renderScreenContext(input.perception.screen, at) });
  let policyEpoch = 0;
  let stopped = false;
  const notify = createPublisher(input, () => stopped);
  const backoff = createInitiativeBackoff({ db: input.db, timezone: input.timezone.timezone,
    modelIntervalMs: () => readInitiativeWakePolicy(input.config).modelCadenceMs,
    onChanged: (id) => { if (input.monitorEnabled()) notify(INITIATIVE_BACKOFF_METHODS.changed, id); } });
  const snapshot = () => readSnapshot(input, completions, policyEpoch);
  const invalidate = (id: string) => invalidateHeartbeat(input, context, id);
  const wake = createInitiativeWakeEngine({ db: input.db, patterns: input.patterns, intentions: input.intentions, backoff, snapshot,
    policy: () => readInitiativePolicy(input.config), wakePolicy: () => readInitiativeWakePolicy(input.config),
     prepareContext: context.prepare, contextIsCurrent: context.isCurrent,
     sourceIsCurrent: input.viewing?.isCurrent, prepareInput: input.viewing?.prepareInput, sourceAdmitted: input.viewing?.admitted,
    runtime: input.runtime, busy: input.queue.isBusy, invalidate,
    onChanged: (id) => { if (input.monitorEnabled()) notify(INITIATIVE_WAKE_METHODS.changed, id); },
    onError: () => input.logger.warn({ code: "INITIATIVE_WAKE_FAILED" }, "Initiative source evaluation failed") });
  const setup = composeSetup(input, completions, notify);
  registerInteractionPatternMethods(input.registry, { service: input.patterns, connections: input.connections });
  registerInitiativeSetupMethods(input.registry, { setup, connections: input.connections,
    monitorEnabled: input.monitorEnabled, policy: wake.read });
  registerInitiativeBackoffMethods(input.registry, { backoff, connections: input.connections, monitorEnabled: input.monitorEnabled });
  const setupChanged = () => {
    const ids = new Set(["taki", initiativeTarget(input.config)]);
    for (const row of input.db.prepare("SELECT DISTINCT character_id FROM interaction_patterns").all()) {
      if (typeof row.character_id === "string") ids.add(row.character_id);
    }
    for (const id of ids) if (id) notify(INITIATIVE_SETUP_METHODS.changed, id);
  };
  return {
    snapshot, setup, wake, backoff,
    start() { input.intentions.reconcile(); wake.start(); },
    sourceChanged() { if (!stopped) { wake.notify("source"); setupChanged(); } },
    policyChanged() { if (!stopped) { policyEpoch += 1; wake.notify("policy"); setupChanged(); } },
    released() { if (!stopped) wake.notify("release"); },
    primaryObserved(characterId: string) {
      if (stopped) return;
      try { backoff.observeUserTurn(characterId); }
      catch { input.logger.warn({ code: "INITIATIVE_ENGAGEMENT_RECONCILE_FAILED" }, "Committed user engagement will be reconciled"); }
      wake.notify("source");
    },
    patternChanged({ characterId }: { characterId: string }) {
      notify(INTERACTION_PATTERN_METHODS.changed, characterId);
      notify(INITIATIVE_SETUP_METHODS.changed, characterId);
      // Revision currentness is owned by the matcher; merely saving a draft cannot retire an active rule.
      if (!stopped) wake.notify("policy");
    },
    committed(events: readonly RunEvent[]) {
      if (!stopped) observeCommitted(input, events, { wake, notify, setupChanged });
    },
    async close() { stopped = true; context.close(); await wake.close(); },
  };
}

function observeCommitted(input: Dependencies, events: readonly RunEvent[], ports: {
  wake: ReturnType<typeof createInitiativeWakeEngine>; notify(method: string, characterId: string): void; setupChanged(): void;
}): void {
  for (const event of events) {
    if (event.kind === "run.settled" || event.kind.startsWith("delivery.")) {
      const plan = input.db.prepare("SELECT intention_id,character_id FROM initiative_intentions WHERE run_id=:runId")
        .get({ runId: event.runId });
      if (plan && typeof plan.intention_id === "string" && typeof plan.character_id === "string") {
        input.intentions.settleLinked({ intentionId: plan.intention_id, characterId: plan.character_id });
      }
    }
    if (event.kind === "delivery.feedback_settled" || event.kind === "run.admitted") {
      // Admission changes daily usage and spacing even for a later silent/failed Run.
      // The separate Monitor backoff reader does not subscribe to wake-policy invalidations.
      const row = input.db.prepare("SELECT character_id FROM runs WHERE run_id=:runId AND initiator='heartbeat' AND delivery_class='class_b'")
        .get({ runId: event.runId });
      if (typeof row?.character_id === "string" && input.monitorEnabled()) ports.notify(INITIATIVE_BACKOFF_METHODS.changed, row.character_id);
      if (event.kind === "delivery.feedback_settled") ports.wake.notify("policy");
    }
  }
  if (events.some((event) => event.kind === "run.settled" && input.db.prepare(
    "SELECT 1 FROM runs WHERE run_id=:runId AND initiator IN ('scheduled','subagent','webhook')").get({ runId: event.runId }))) {
    ports.wake.notify("source"); ports.setupChanged();
  }
}

function createPublisher(input: Dependencies, stopped: () => boolean) {
  return (method: string, characterId: string): void => {
    if (stopped()) return;
    for (const connection of input.connections.list()) {
      if (connection.state.status !== "authenticated" || connection.state.role !== "operator") continue;
      try { connection.notify?.(method, { characterId }); }
      catch { input.logger.warn({ code: "INITIATIVE_NOTIFICATION_FAILED" }, "Initiative view notification failed"); }
    }
  };
}

function readSnapshot(input: Dependencies, completions: ReturnType<typeof createInitiativeCompletionSource>, policyEpoch: number): InitiativeWakeSnapshot {
    const targetId = initiativeTarget(input.config);
    const timezone = input.timezone.read();
    return { enabled: input.config.resolve("TAKI_INITIATIVE_ENABLED")?.value === true,
      targetId, targetReady: targetId !== null && input.targetReady(targetId),
      policyRevision: wakeDigest(JSON.stringify([policyEpoch, targetId, readInitiativePolicy(input.config), readInitiativeWakePolicy(input.config)])),
      timezone: timezone.timezone, timezoneRevision: timezone.revision,
      primaryVersion: targetId ? input.queue.primaryVersion(targetId) : 0,
      privacyPaused: input.perception.pause.isPaused(), presence: input.presence.snapshot().state,
      foreground: input.perception.evidence.foreground(Date.now()) ?? null,
      presenceReturn: input.presence.recentReturn() ?? null,
      completions: targetId ? completions.read(targetId) : [], intentions: targetId ? input.intentions.listDue(targetId) : [],
      viewing: targetId ? input.viewing?.facts(targetId) ?? [] : [] };
  }

function composeSetup(input: Dependencies, completions: ReturnType<typeof createInitiativeCompletionSource>,
  notify: (method: string, characterId: string) => void) {
  return createInitiativeSetup({ config: input.config, timezone: input.timezone, patterns: input.patterns,
    skill: createAuthoringSkillSetup(input.skills), targetReady: input.targetReady, completions: completions.choices,
    sources: () => ({ activityAvailable: input.perception.evidence.foreground(Date.now()) !== undefined,
      application: input.perception.evidence.foreground(Date.now())?.application ?? null,
      presence: input.presence.snapshot().state, intentionAvailable: true }),
    onChanged: (id) => notify(INITIATIVE_SETUP_METHODS.changed, id) });
}

function invalidateHeartbeat(input: Dependencies, context: ReturnType<typeof createInitiativeContextBuilder>, characterId: string): void {
    context.cancel(characterId);
    // Never use Character-wide cancellation: primary/scheduled work shares the same lane.
    const active = input.db.prepare("SELECT run_id FROM runs WHERE character_id=:characterId AND initiator='heartbeat' AND state IN ('queued','running','waiting','waiting_approval')")
      .all({ characterId });
    for (const row of active) if (typeof row.run_id === "string") input.turns.cancel(characterId, row.run_id);
  }
