/**
 * INPUT: active accepted Pattern data and current bounded evidence envelopes
 * OUTPUT: deterministic finite-condition candidates with stable source occurrence and provenance
 * POS: core/initiative/wake — matching only; missing/unknown observations never become user facts
 */
import { createHash } from "node:crypto";
import type { InteractionPatternCondition, InteractionPatternView } from "@taki/shared";
import { InitiativeForegroundFactSchema, InitiativePresenceReturnSchema,
  InitiativeCompletionFactSchema, InitiativeDueIntentionSchema } from "@taki/shared";
import type { InitiativeWakeSnapshot, WakeCandidate, WakePatternCandidate, WakeMatch } from "./wake-contract.ts";
import { matchClockWindow } from "./wake-clock.ts";

export const WAKE_SOURCE_FRESH_MS = 60_000;
const SOURCE_PRIORITY = { intention: 0, completion: 1, media: 2, clock: 3, activity: 4, presence: 5 } as const;
type ReasonFact = Omit<WakePatternCandidate, "kind" | "candidateId" | "patternId" | "patternVersion" | "revisionId" | "definition">;
export function wakeDigest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function deterministicChance(key: string): number {
  return Number.parseInt(wakeDigest(key).slice(0, 12), 16) / 0x1000000000000;
}
function fresh(observedAt: number, now: number): boolean { return observedAt <= now && now - observedAt < WAKE_SOURCE_FRESH_MS; }

export function matchWakePatterns(patterns: readonly InteractionPatternView[], snapshot: InitiativeWakeSnapshot, now: number): WakeMatch {
  const candidates: WakeCandidate[] = [];
  let reason: WakeMatch["reason"] = patterns.length ? "conditions-unmet" : "no-pattern";
  for (const pattern of patterns.slice(0, 100)) {
    const revision = pattern.effectiveRevision;
    if (pattern.state !== "active" || !revision?.acceptedAt || pattern.characterId !== snapshot.targetId) continue;
    const lifetime = revision.definition.lifetime;
    if ((lifetime.startsAt && Date.parse(lifetime.startsAt) > now) || (lifetime.expiresAt && Date.parse(lifetime.expiresAt) <= now)) continue;
    const result = matchConditions(revision.definition.conditions.all, snapshot, now);
    if (!result.fact) { reason = result.reason; continue; }
    const fact = result.fact;
    const expiresAt = Math.min(fact.expiresAt, lifetime.expiresAt ? Date.parse(lifetime.expiresAt) : Infinity);
    candidates.push({ ...fact, kind: "pattern", expiresAt, patternId: pattern.patternId, patternVersion: pattern.version,
      revisionId: revision.revisionId, definition: revision.definition,
      candidateId: wakeDigest(`${pattern.patternId}\n${revision.revisionId}\n${fact.occurrenceKey}`) });
  }
  candidates.sort(compareWakeCandidates);
  return { candidates, reason: candidates.length ? "admitted" : reason };
}

export function compareWakeCandidates(a: WakeCandidate, b: WakeCandidate): number {
  return a.dueAt - b.dueAt || SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] || a.candidateId.localeCompare(b.candidateId);
}

function matchConditions(conditions: InteractionPatternCondition[], snapshot: InitiativeWakeSnapshot, now: number):
  { fact?: ReasonFact; reason: WakeMatch["reason"] } {
  const facts: ReasonFact[] = [];
  for (const condition of conditions) {
    const result = conditionFact(condition, snapshot, now);
    if (result.reason) return { reason: result.reason };
    if (result.fact) facts.push(result.fact);
  }
  facts.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  const first = facts[0];
  if (!first) return { reason: "no-signal" };
  return { fact: { ...first, sampling: facts.some((fact) => fact.sampling),
    // Every conjunct is a validity fence, even when clock/completion supplies the primary reason.
    sourceRevision: wakeDigest(facts.map((fact) => fact.sourceRevision).join("\n")),
    expiresAt: Math.min(...facts.map((fact) => fact.expiresAt)) }, reason: "admitted" };
}

function conditionFact(condition: InteractionPatternCondition, snapshot: InitiativeWakeSnapshot, now: number):
  { fact?: ReasonFact; reason?: WakeMatch["reason"] } {
  if (condition.kind === "local_time_window") {
    const window = matchClockWindow(now, snapshot.timezone, condition);
    return window ? { fact: { ...window, source: "clock", sourceKey: `clock:${wakeDigest(window.occurrenceKey)}`,
      sourceRevision: String(snapshot.timezoneRevision), dueAt: now, sampling: false, causeRunId: null } } : { reason: "conditions-unmet" };
  }
  if (condition.kind === "completion_of") return completionFact(condition.runId, snapshot, now);
  if (condition.kind === "intention_due") return intentionFact(snapshot, now);
  if (condition.kind === "presence_present") {
    if (snapshot.presence !== "present") return { reason: "absence-unknown" };
    return { fact: presenceFact(snapshot, now) };
  }
  return foregroundFact(condition, snapshot, now);
}

function foregroundFact(condition: InteractionPatternCondition, snapshot: InitiativeWakeSnapshot, now: number):
  { fact?: ReasonFact; reason?: WakeMatch["reason"] } {
  if (snapshot.privacyPaused) return { reason: "privacy-paused" };
  const parsed = InitiativeForegroundFactSchema.safeParse(snapshot.foreground);
  if (!parsed.success) return { reason: "missing-source" };
  const fact = parsed.data;
  if (!fresh(fact.observedAt, now)) return { reason: "stale-source" };
  if (!fact.meaningful) return { reason: "no-signal" };
  if (condition.kind === "application_in_set" && !condition.applications.some((app) => app.toLowerCase() === fact.application.toLowerCase())) return { reason: "conditions-unmet" };
  if (condition.kind === "activity_dwell_at_least" && fact.observedAt - fact.startedAt < condition.minutes * 60_000) return { reason: "conditions-unmet" };
  if (condition.kind === "known_idle_state") {
    if (fact.idleSeconds === null) return { reason: "missing-source" };
    if ((fact.idleSeconds >= 180) !== (condition.state === "idle")) return { reason: "conditions-unmet" };
  }
  return { fact: { source: "activity", occurrenceKey: fact.occurrenceKey, sourceKey: `activity:${wakeDigest(fact.occurrenceKey)}`,
    sourceRevision: `${fact.hostId}:${fact.connectionGeneration}:${fact.catalogGeneration}:${fact.observationEpoch}:${fact.occurrenceKey}`,
    dueAt: fact.startedAt, expiresAt: fact.observedAt + WAKE_SOURCE_FRESH_MS, sampling: true, causeRunId: null } };
}

function presenceFact(snapshot: InitiativeWakeSnapshot, now: number): ReasonFact | undefined {
  const parsed = InitiativePresenceReturnSchema.safeParse(snapshot.presenceReturn);
  if (!parsed.success || !fresh(parsed.data.inputAt, now) || parsed.data.inputAt - parsed.data.knownInactiveSince < 600_000) return;
  const fact = parsed.data;
  return { source: "presence", occurrenceKey: fact.occurrenceKey, sourceKey: `presence:${wakeDigest(fact.occurrenceKey)}`,
    sourceRevision: `${fact.sourceKey}:${fact.sourceGeneration}`, dueAt: fact.inputAt,
    expiresAt: fact.inputAt + WAKE_SOURCE_FRESH_MS, sampling: false, causeRunId: null };
}

function completionFact(runId: string, snapshot: InitiativeWakeSnapshot, now: number): { fact?: ReasonFact; reason?: WakeMatch["reason"] } {
  const parsed = InitiativeCompletionFactSchema.safeParse(snapshot.completions.slice(0, 100).find((fact) => fact.runId === runId));
  if (!parsed.success) return { reason: "missing-source" };
  const fact = parsed.data;
  if (fact.characterId !== snapshot.targetId || !["scheduled", "subagent", "webhook"].includes(fact.initiator)
    || fact.deliveredClassA) return { reason: "conditions-unmet" };
  if (!fresh(fact.completedAt, now)) return { reason: "stale-source" };
  return { fact: { source: "completion", occurrenceKey: fact.runId, sourceKey: `completion:${wakeDigest(fact.runId)}`,
    sourceRevision: String(fact.completedAt), dueAt: fact.completedAt, expiresAt: fact.completedAt + WAKE_SOURCE_FRESH_MS,
    sampling: false, causeRunId: fact.runId } };
}

function intentionFact(snapshot: InitiativeWakeSnapshot, now: number): { fact?: ReasonFact; reason?: WakeMatch["reason"] } {
  const fact = snapshot.intentions.slice(0, 100).filter((entry) => InitiativeDueIntentionSchema.safeParse(entry).success
    && entry.characterId === snapshot.targetId && entry.notBefore <= now && entry.expiresAt > now)
    .sort((a, b) => a.notBefore - b.notBefore)[0];
  if (!fact) return { reason: "missing-source" };
  return { fact: { source: "intention", occurrenceKey: fact.intentionId, sourceKey: `intention:${wakeDigest(fact.intentionId)}`,
    sourceRevision: fact.sourceRevision, dueAt: fact.notBefore, expiresAt: fact.expiresAt, sampling: false, causeRunId: null } };
}
