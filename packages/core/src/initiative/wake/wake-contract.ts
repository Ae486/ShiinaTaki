/**
 * INPUT: existing Pattern, Perception, Presence, time and runtime authorities
 * OUTPUT: composition-only ports and captured deterministic match contracts
 * POS: core/initiative/wake — callers supply real sources; no acquisition or Agent loop
 */
import type { InitiativeSelectedContext } from "@taki/shared";
import type { InteractionPatternView, InteractionPatternDefinition } from "@taki/shared";
import type { InitiativeForegroundFact, InitiativePresenceReturn, InitiativeCompletionFact,
  InitiativeDueIntention, InitiativeViewingFact, InitiativeWakeReason, InitiativeWakeEvaluation } from "@taki/shared";
import type { TurnContext } from "../../agents/chat-agent.ts";
import type { Database } from "../../db/sqlite.ts";
import type { InitiativePolicy } from "../../config/initiative-policy-config.ts";
import type { InitiativeWakePolicy } from "../../config/initiative-wake-config.ts";
import type { InitiativeRuntime } from "../initiative-runtime.ts";
import type { IntentionService } from "../intentions/intention-service.ts";
import type { InitiativeBackoff } from "../backoff/initiative-backoff.ts";

export interface InitiativeWakeSnapshot {
  enabled: boolean; targetId: string | null; targetReady: boolean; policyRevision: string;
  timezone: string; timezoneRevision: number; primaryVersion: number; privacyPaused: boolean;
  presence: "present" | "unknown";
  foreground: InitiativeForegroundFact | null;
  presenceReturn: InitiativePresenceReturn | null;
  completions: InitiativeCompletionFact[];
  intentions: InitiativeDueIntention[];
  viewing?: InitiativeViewingFact[];
}
interface WakeCandidateBase {
  candidateId: string; revisionId: string;
  definition: Pick<InteractionPatternDefinition, "title" | "purpose" | "contextSelectors" | "allowedOutcomes">;
  source: Exclude<InitiativeWakeEvaluation["source"], "none">;
  occurrenceKey: string; sourceKey: string; sourceRevision: string;
  dueAt: number; expiresAt: number; sampling: boolean; causeRunId: string | null;
}
export interface WakePatternCandidate extends WakeCandidateBase {
  kind: "pattern"; patternId: string; patternVersion: number; definition: InteractionPatternDefinition;
}
export interface WakeIntentionCandidate extends WakeCandidateBase {
  kind: "intention"; intentionId: string;
}
export interface WakeMediaCandidate extends WakeCandidateBase {
  kind: "media"; viewingId: string;
}
export type WakeCandidate = WakePatternCandidate | WakeIntentionCandidate | WakeMediaCandidate;
export interface WakeSelection {
  opportunityId: string; sourceKey: string; characterId: string; capturedAt: number; expiresAt: number;
  snapshot: InitiativeWakeSnapshot; candidates: WakeCandidate[];
}
export interface InitiativeWakeDependencies {
  db: Database;
  patterns: { listActive(characterId: string): InteractionPatternView[] };
  intentions?: Pick<IntentionService, "claim" | "link" | "isCurrent" | "releaseUnadmitted" | "settleLinked" | "nextWakeAt">;
  backoff?: Pick<InitiativeBackoff, "refusal" | "recordAdmission">;
  snapshot(): InitiativeWakeSnapshot;
  policy(): InitiativePolicy;
  wakePolicy(): InitiativeWakePolicy;
  prepareContext(selection: WakeSelection): Promise<InitiativeSelectedContext | undefined>;
  /** The thin-input assembler retains its original provider/authority binding across later C1 admission. */
  contextIsCurrent?(selection: WakeSelection): boolean;
  sourceIsCurrent?(selection: WakeSelection): boolean;
  prepareInput?(selection: WakeSelection, turn: TurnContext): Promise<string | undefined>;
  sourceAdmitted?(selection: WakeSelection, identity: { runId: string; attemptId: string }): boolean;
  runtime: InitiativeRuntime;
  /** Read-only availability. C1 still acquires the atomic Character lane immediately before Run admission. */
  busy(characterId: string): boolean;
  /** Immediate current-work cancellation uses the existing Run/Turn owner, never a second controller. */
  invalidate?(characterId: string): void;
  onChanged?(characterId: string): void | Promise<void>;
  onError?(error: unknown): void;
  now?(): number;
}
export interface WakeMatch {
  candidates: WakeCandidate[];
  reason: InitiativeWakeReason;
}
