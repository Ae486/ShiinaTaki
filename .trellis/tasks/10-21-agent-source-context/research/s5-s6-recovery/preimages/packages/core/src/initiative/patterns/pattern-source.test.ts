import { afterEach, describe, expect, it } from "vitest";
import type { InteractionPatternDefinition, InteractionPatternMutationResult, InteractionPatternView, RunInitiator } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { interactionPatternsMigration052 } from "../../db/migrations/052-interaction-patterns.ts";
import { createRunRepo } from "../../db/run-repo.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createInteractionPatternService } from "./pattern-service.ts";
import type { InteractionPatternActor } from "./pattern-source.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const definition: InteractionPatternDefinition = {
  title: "Break check-in", purpose: "Consider a brief check-in after sustained editor use.",
  conditions: { all: [{ kind: "application_in_set", applications: ["Editor"] }, { kind: "activity_dwell_at_least", minutes: 45 }] },
  contextSelectors: ["accepted_activity"], allowedOutcomes: ["silent", "express", "speak"],
  timing: { minimumGapMinutes: 60, chance: 0.5 }, lifetime: { startsAt: null, expiresAt: null },
};
const input = { characterId: "taki", commandId: "call", patternId: null, expectedVersion: 0, definition };
function fixture(initiator: RunInitiator = "primary") {
  const db = openDatabase({ path: ":memory:", migrations: [...MIGRATIONS.filter((m) => m.version < 52), interactionPatternsMigration052] });
  dbs.push(db);
  const repo = createRunRepo(db);
  const admission = repo.admit({ runId: "run", provider: "scripted", modelId: "local",
    request: { triggerRequestId: "trigger", idempotencyKey: "idempotency", characterId: "taki", initiator,
      provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" },
    snapshot: { schemaVersion: "slice1.v1", characterId: "taki", initiator, provenance: { provider: "chat" },
      deliveryClass: "class_a", contextMode: "primary", modelProvider: "scripted", modelId: "local", primaryHostId: "core-host",
      hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64),
      governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 },
      memory: { providerId: "legacy-markdown", contractVersion: 1, capabilityDigest: "b".repeat(64), capabilities: {
        providerId: "legacy-markdown", contractVersion: 1, retain: true, recall: true, reflect: false, edit: false,
        invalidate: true, restore: false, conditionalMutation: false, idempotentWrites: false,
        sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false,
      } }, contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" },
      replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "slice1.v1" }, sourceRefs: [],
    },
  });
  repo.start(admission.run.runId, admission.attempt.attemptId);
  const timeline = createTimelineRepo(db);
  const user = timeline.append({ characterId: "taki", role: "user", content: "Please check in after I use Editor for 45 minutes." });
  const service = createInteractionPatternService({ db });
  const actor: Extract<InteractionPatternActor, { kind: "agent" }> = { kind: "agent", runId: admission.run.runId,
    attemptId: admission.attempt.attemptId, toolCallId: "tool-call" };
  const source = { characterId: "taki", runId: actor.runId, attemptId: actor.attemptId, userTimelineSeq: user.seq, userTimelineId: user.id };
  return { db, repo, admission, timeline, user, service, actor, source };
}
function successful(result: InteractionPatternMutationResult): InteractionPatternView {
  expect(result.status).toBe("applied");
  if (result.status === "refused") throw new Error(result.reason);
  return result.pattern;
}

describe("trusted primary Pattern sources", () => {
  it("requires an actual registered source and refuses model-authored reviewer claims", () => {
    const f = fixture();
    expect(f.service.propose(input, f.actor)).toMatchObject({ status: "refused", reason: "source_unavailable" });
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    const candidate = successful(f.service.propose(input, f.actor));
    expect(candidate.candidateRevision?.origin.kind).toBe("agent");
    expect(f.service.confirm({ characterId: "taki", patternId: candidate.patternId, commandId: "confirm", expectedVersion: 1,
      candidateRevisionId: candidate.candidateRevision!.revisionId }, { ...f.actor, toolCallId: "confirm-call" })).toMatchObject({ status: "refused", reason: "forbidden" });
    expect(f.service.propose({ ...input, reviewer: "user" } as never, f.actor)).toMatchObject({ status: "refused", reason: "invalid_request" });
    expect(f.service.propose(input, { ...f.actor, kind: "operator", operatorId: "spoof" } as never))
      .toMatchObject({ status: "refused", reason: "forbidden" });
  });

  it("deduplicates a replayed tool invocation and a changed tool ID using the same source/definition", () => {
    const f = fixture();
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    const candidate = successful(f.service.propose(input, f.actor));
    expect(f.service.propose(input, f.actor)).toEqual({ status: "duplicate", pattern: candidate });
    expect(f.service.propose({ ...input, commandId: "new-invocation" }, { ...f.actor, toolCallId: "new-tool-id" }))
      .toEqual({ status: "duplicate", pattern: candidate });
    expect(f.service.propose({ ...input, definition: { ...definition, title: "Changed command" } }, f.actor))
      .toMatchObject({ status: "refused", reason: "command_conflict" });
    expect(f.db.prepare("SELECT count(*) AS n FROM interaction_patterns").get()?.n).toBe(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM interaction_pattern_revisions").get()?.n).toBe(1);
  });

  it.each(["heartbeat", "scheduled", "flush", "subagent"] as const)("refuses %s as a source of permanent Pattern authoring", (kind) => {
    const f = fixture(kind);
    expect(f.service.registerPrimarySource(f.source)).toBe(false);
    expect(f.service.propose(input, f.actor)).toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
  });

  it("refuses foreign Character, wrong role, wrong row identity and pre-Run history", () => {
    const f = fixture();
    const assistant = f.timeline.append({ characterId: "taki", role: "assistant", content: "A model statement is not a user request." });
    const other = f.timeline.append({ characterId: "other", role: "user", content: "Foreign request." });
    expect(f.service.registerPrimarySource({ ...f.source, userTimelineSeq: assistant.seq, userTimelineId: assistant.id })).toBe(false);
    expect(f.service.registerPrimarySource({ ...f.source, userTimelineSeq: other.seq, userTimelineId: other.id })).toBe(false);
    expect(f.service.registerPrimarySource({ ...f.source, userTimelineId: "invented" })).toBe(false);
    expect(f.service.registerPrimarySource({ ...f.source, characterId: "other" })).toBe(false);
    f.db.prepare("UPDATE timeline_messages SET created_at='2000-01-01T00:00:00.000Z' WHERE seq=:seq").run({ seq: f.user.seq });
    expect(f.service.registerPrimarySource(f.source)).toBe(false);
  });

  it("fences edited/deleted user source and does not block ordinary Timeline retraction", () => {
    const f = fixture();
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    f.db.prepare("UPDATE timeline_messages SET content='changed request' WHERE seq=:seq").run({ seq: f.user.seq });
    expect(f.service.propose(input, f.actor)).toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.service.registerPrimarySource(f.source)).toBe(false);
    expect(() => f.timeline.deleteEntry("taki", f.user.seq)).not.toThrow();
    expect(f.service.propose(input, f.actor)).toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
  });

  it("binds retry to the same user source while refusing the old Attempt and terminal callbacks", () => {
    const f = fixture();
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    const candidate = successful(f.service.propose(input, f.actor));
    const retried = f.repo.retry(f.actor.runId, f.actor.attemptId, "overflow");
    const actor = { ...f.actor, attemptId: retried.run.activeAttemptId! };
    expect(f.service.propose(input, f.actor)).toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.service.registerPrimarySource({ ...f.source, attemptId: actor.attemptId })).toBe(true);
    expect(f.service.propose(input, actor)).toEqual({ status: "duplicate", pattern: candidate });
    f.repo.settle({ runId: actor.runId, attemptId: actor.attemptId, outcome: "completed", retryability: "not_retryable" });
    expect(f.service.propose(input, actor)).toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.db.prepare("SELECT count(*) AS n FROM interaction_patterns").get()?.n).toBe(1);
  });

  it("never rebinds a Run to a later user row", () => {
    const f = fixture();
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    const next = f.timeline.append({ characterId: "taki", role: "user", content: "Another request." });
    expect(f.service.registerPrimarySource({ ...f.source, userTimelineSeq: next.seq, userTimelineId: next.id })).toBe(false);
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    expect(f.db.prepare("SELECT count(*) AS n FROM interaction_pattern_primary_sources").get()?.n).toBe(1);
  });

  it("allows review after authoring settlement but refuses a candidate whose actual user evidence was removed", () => {
    const f = fixture();
    expect(f.service.registerPrimarySource(f.source)).toBe(true);
    const candidate = successful(f.service.propose(input, f.actor));
    f.repo.settle({ runId: f.actor.runId, attemptId: f.actor.attemptId, outcome: "completed", retryability: "not_retryable" });
    const operator = { kind: "operator", operatorId: "owner" } as const;
    const review = { characterId: "taki", patternId: candidate.patternId, commandId: "confirm", expectedVersion: candidate.version,
      candidateRevisionId: candidate.candidateRevision!.revisionId };
    const second = fixture();
    expect(second.service.registerPrimarySource(second.source)).toBe(true);
    const other = successful(second.service.propose(input, second.actor));
    second.timeline.deleteEntry("taki", second.user.seq);
    expect(second.service.confirm({ ...review, patternId: other.patternId, candidateRevisionId: other.candidateRevision!.revisionId }, operator))
      .toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.service.confirm(review, operator)).toMatchObject({ status: "applied", pattern: { state: "active" } });
    expect(f.db.prepare("SELECT source_run_id,author_key FROM interaction_pattern_revisions").get())
      .toMatchObject({ source_run_id: f.actor.runId, author_key: `agent:${f.actor.runId}` });
  });

  it("refuses malformed source timestamps", () => {
    const f = fixture();
    f.db.prepare("UPDATE timeline_messages SET created_at='invalid' WHERE seq=:seq").run({ seq: f.user.seq });
    expect(f.service.registerPrimarySource(f.source)).toBe(false);
  });
});
