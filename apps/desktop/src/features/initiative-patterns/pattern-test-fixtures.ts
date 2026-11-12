/**
 * INPUT: explicit test overrides for isolated Pattern projections.
 * OUTPUT: valid deterministic definitions/revisions and a typed disposable client fixture.
 * POS: colocated test support only; not imported by production pages or runtime authorities.
 */
import { vi } from "vitest";
import type { InitiativeSetupStatus, InteractionPatternChanged, InteractionPatternDefinition, InteractionPatternView } from "@taki/shared";
import type { PatternClient } from "./pattern-state.ts";

export function definition(): InteractionPatternDefinition {
  return { title: "晚间回顾", purpose: "晚饭后轻松聊聊今天", conditions: { all: [
    { kind: "local_time_window", start: "19:00", end: "21:00", daysOfWeek: [1, 2, 3, 4, 5] }, { kind: "presence_present" },
  ] }, contextSelectors: ["memory_character"], allowedOutcomes: ["silent", "speak"],
  timing: { minimumGapMinutes: 60, chance: 0.25 }, lifetime: { startsAt: null, expiresAt: null } };
}

export function pattern(overrides: Partial<InteractionPatternView> = {}): InteractionPatternView {
  return { patternId: "opaque-pattern", characterId: "taki", state: "proposed", version: 178923,
    effectiveRevision: null, candidateRevision: { revisionId: "opaque-revision", baseVersion: 178922,
      definition: definition(), origin: { kind: "agent", description: "根据当前对话提出" }, changes: ["purpose", "conditions"],
      createdAt: "2026-09-28T10:00:00Z", acceptedAt: null }, createdAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-28T10:00:00Z", ...overrides };
}

export function setupStatus(): InitiativeSetupStatus {
  return { characterId: "taki", targetCharacterId: "taki", targetReady: true, settings: [], timezone: "Asia/Shanghai", timezoneConfirmed: true,
    sources: { activityAvailable: false, application: null, presence: "unknown", intentionAvailable: false }, completions: [],
    skill: { state: "missing", packageId: null, configRevision: null }, seeds: [] };
}

export function patternClient(initial = pattern()) {
  let row = initial;
  const listeners = new Set<(event: InteractionPatternChanged) => void>();
  const client: PatternClient = {
    initiativePatternsList: vi.fn(async () => ({ patterns: [row], nextAfter: null })),
    initiativePatternRead: vi.fn(async () => ({ pattern: row })),
    initiativePatternHistory: vi.fn(async () => ({ revisions: row.candidateRevision ? [row.candidateRevision] : [], nextBefore: null })),
    initiativePatternPropose: vi.fn<PatternClient["initiativePatternPropose"]>(async () => ({ status: "applied", pattern: row })),
    initiativePatternConfirm: vi.fn<PatternClient["initiativePatternConfirm"]>(async () => ({ status: "applied", pattern: row })),
    initiativePatternChangeState: vi.fn<PatternClient["initiativePatternChangeState"]>(async () => ({ status: "applied", pattern: row })),
    initiativePatternRollback: vi.fn<PatternClient["initiativePatternRollback"]>(async () => ({ status: "applied", pattern: row })),
    onInitiativePatternsChanged: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { client, setRow(next: InteractionPatternView) { row = next; }, changed() { listeners.forEach((listener) => listener({ characterId: "taki" })); } };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
