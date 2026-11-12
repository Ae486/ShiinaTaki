/**
 * INPUT: current accepted Patterns and actual due Intention source projections
 * OUTPUT: one ordered candidate set without inventing stored Patterns or renewing source windows
 * POS: core/initiative/wake — finite source adaptation; admission and consumption stay with their owners
 */
import { InitiativeDueIntentionSchema, InitiativeViewingFactSchema, type InteractionPatternView } from "@taki/shared";
import type { InitiativeWakeSnapshot, WakeCandidate, WakeMatch } from "./wake-contract.ts";
import { compareWakeCandidates, matchWakePatterns, wakeDigest } from "./wake-matcher.ts";

export function matchWakeSources(patterns: readonly InteractionPatternView[], snapshot: InitiativeWakeSnapshot, now: number): WakeMatch {
  const matched = matchWakePatterns(patterns, snapshot, now);
  const candidates = [...matched.candidates, ...matchDueIntentions(snapshot, now), ...matchViewing(snapshot, now)].sort(compareWakeCandidates);
  return { candidates, reason: candidates.length ? "admitted" : matched.reason };
}

function matchViewing(snapshot: InitiativeWakeSnapshot, now: number): WakeCandidate[] {
  if (snapshot.privacyPaused || snapshot.presence !== "present") return [];
  return (snapshot.viewing ?? []).slice(0, 64).flatMap((value): WakeCandidate[] => {
    const parsed = InitiativeViewingFactSchema.safeParse(value);
    if (!parsed.success) return [];
    const fact = parsed.data;
    if (fact.characterId !== snapshot.targetId || fact.eligibleAt > now || fact.expiresAt <= now) return [];
    return [{ kind: "media", viewingId: fact.viewingId,
      candidateId: wakeDigest(`media\n${fact.characterId}\n${fact.viewingId}`), revisionId: fact.sourceRevision,
      source: "media", occurrenceKey: fact.viewingId, sourceKey: `media:${wakeDigest(`${fact.characterId}:${fact.viewingId}`)}`,
      sourceRevision: fact.sourceRevision, dueAt: fact.eligibleAt, expiresAt: fact.expiresAt, sampling: true, causeRunId: null,
      definition: { title: "观看邀请", purpose: "Consider inviting the user to watch this exact video together, using the supplied captured understanding and actual access evidence. Only invite or remain silent; do not analyze the video or start watching before acceptance.",
        contextSelectors: ["memory_global", "memory_character"], allowedOutcomes: ["silent", "speak"] } }];
  });
}

function matchDueIntentions(snapshot: InitiativeWakeSnapshot, now: number): WakeCandidate[] {
  return snapshot.intentions.slice(0, 100).flatMap((candidate): WakeCandidate[] => {
    const parsed = InitiativeDueIntentionSchema.safeParse(candidate);
    if (!parsed.success) return [];
    const fact = parsed.data;
    if (fact.characterId !== snapshot.targetId || fact.notBefore > now || fact.expiresAt <= now) return [];
    return [{ kind: "intention", intentionId: fact.intentionId,
      candidateId: wakeDigest(`intention\n${fact.intentionId}\n${fact.sourceRevision}`), revisionId: fact.sourceRevision,
      definition: { title: "后续关心", purpose: fact.purpose,
        contextSelectors: ["memory_global", "memory_character"], allowedOutcomes: ["silent", "express", "speak"] },
      source: "intention", occurrenceKey: fact.intentionId, sourceKey: `intention:${wakeDigest(fact.intentionId)}`,
      sourceRevision: fact.sourceRevision, dueAt: fact.notBefore, expiresAt: fact.expiresAt,
      sampling: false, causeRunId: null }];
  });
}
