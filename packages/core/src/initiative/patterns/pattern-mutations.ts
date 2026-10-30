/**
 * INPUT: validated scoped commands, current Pattern and Core-derived actors inside a writer transaction
 * OUTPUT: exact candidate drafts, review CAS and explicit lifecycle/rollback transitions
 * POS: core/initiative/patterns — domain transitions; no permissions, replay or execution effects
 */
import { randomUUID } from "node:crypto";
import type {
  InteractionPatternProposeParams, InteractionPatternConfirmParams, InteractionPatternChangeStateParams,
  InteractionPatternRollbackParams, InteractionPatternMutationResult, InteractionPatternView,
  InteractionPatternRefusalReason,
} from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { patternDigest, patternOrigin, patternActorKey, validatePatternRevisionSource, type InteractionPatternActor } from "./pattern-source.ts";
import { insertPatternRevision, patternCount, patternRevisionCount, readPattern, readPatternRevision, requirePattern, updatePattern } from "./pattern-store.ts";

export interface PatternMutationContext { db: Database; actor: InteractionPatternActor; at: string }
export function refusePattern(reason: InteractionPatternRefusalReason, current: InteractionPatternView | null = null): InteractionPatternMutationResult {
  return { status: "refused", reason, current };
}

export function proposePattern(ctx: PatternMutationContext, input: InteractionPatternProposeParams): InteractionPatternMutationResult {
  if (ctx.actor.kind === "seed" && input.patternId === null) {
    const seed = ctx.db.prepare("SELECT pattern_id FROM interaction_patterns WHERE character_id=:characterId AND seed_key=:seedKey")
      .get({ characterId: input.characterId, seedKey: ctx.actor.seedId });
    if (seed) return { status: "duplicate", pattern: requirePattern(ctx.db, { characterId: input.characterId, patternId: String(seed.pattern_id) }) };
  }
  const current = input.patternId ? readPattern(ctx.db, { characterId: input.characterId, patternId: input.patternId }) : null;
  const refusal = proposalRefusal(ctx, input, current);
  if (refusal) return refusal;
  const sourceKey = patternDigest(ctx.actor.kind === "agent"
    ? ["agent", ctx.actor.runId, input.patternId, input.definition]
    : [patternActorKey(ctx.actor), ctx.actor.kind === "seed" ? ctx.actor.seedVersion : input.commandId, input]);
  const existing = ctx.db.prepare("SELECT pattern_id FROM interaction_pattern_revisions WHERE source_key=:sourceKey").get({ sourceKey });
  if (existing) return { status: "duplicate", pattern: requirePattern(ctx.db, { characterId: input.characterId, patternId: String(existing.pattern_id) }) };
  const pattern = current ?? insertIdentity(ctx, input.characterId);
  insertPatternRevision(ctx.db, { pattern, revisionId: randomUUID(), definition: input.definition,
    origin: patternOrigin(ctx.actor), sourceKey, authorKey: patternActorKey(ctx.actor),
    sourceRunId: ctx.actor.kind === "agent" ? ctx.actor.runId : null, at: ctx.at, newPattern: current === null });
  return { status: "applied", pattern: requirePattern(ctx.db, pattern) };
}

function proposalRefusal(ctx: PatternMutationContext, input: InteractionPatternProposeParams, current: InteractionPatternView | null): InteractionPatternMutationResult | null {
  if (input.patternId && !current) return refusePattern("not_found");
  if ((current?.version ?? 0) !== input.expectedVersion) return refusePattern("conflict", current);
  if (current?.state === "retired") return refusePattern("invalid_state", current);
  if (current && patternRevisionCount(ctx.db, current.patternId) >= 1000) return refusePattern("limit_reached", current);
  if (!current && patternCount(ctx.db, input.characterId) >= 100) return refusePattern("limit_reached");
  if (expiredDefinition(input.definition, ctx.at)) return refusePattern("expired", current);
  if (ctx.actor.kind === "seed") {
    const existing = ctx.db.prepare("SELECT pattern_id FROM interaction_patterns WHERE character_id=:characterId AND seed_key=:seedKey")
      .get({ characterId: input.characterId, seedKey: ctx.actor.seedId });
    if (existing && existing.pattern_id !== input.patternId) {
      return refusePattern("conflict", readPattern(ctx.db, { characterId: input.characterId, patternId: String(existing.pattern_id) }));
    }
    if (current && existing?.pattern_id !== current.patternId) return refusePattern("forbidden", current);
  }
  return null;
}

function insertIdentity(ctx: PatternMutationContext, characterId: string): InteractionPatternView {
  const patternId = randomUUID();
  ctx.db.prepare(`INSERT INTO interaction_patterns(pattern_id,character_id,state,version,seed_key,created_at,updated_at)
    VALUES(:patternId,:characterId,'proposed',1,:seedKey,:at,:at)`)
    .run({ patternId, characterId, seedKey: ctx.actor.kind === "seed" ? ctx.actor.seedId : null, at: ctx.at });
  return requirePattern(ctx.db, { characterId, patternId });
}

export function confirmPattern(ctx: PatternMutationContext, input: InteractionPatternConfirmParams): InteractionPatternMutationResult {
  const current = readPattern(ctx.db, input);
  if (ctx.actor.kind !== "operator") return refusePattern("forbidden", current);
  const refusal = mutationRefusal(current, input.expectedVersion);
  if (refusal || !current) return refusal ?? refusePattern("not_found");
  const candidate = current.candidateRevision;
  if (!candidate || candidate.revisionId !== input.candidateRevisionId) return refusePattern("conflict", current);
  if (current.state === "retired") return refusePattern("invalid_state", current);
  if (expiredDefinition(candidate.definition, ctx.at)) return refusePattern("expired", current);
  const source = validatePatternRevisionSource(ctx.db, candidate.revisionId);
  if (source) return refusePattern(source, current);
  ctx.db.prepare("INSERT INTO interaction_pattern_reviews(revision_id,reviewer_key,accepted_at) VALUES(:revisionId,:reviewer,:at)")
    .run({ revisionId: candidate.revisionId, reviewer: patternActorKey(ctx.actor), at: ctx.at });
  updatePattern(ctx.db, { pattern: current, at: ctx.at, candidateRevisionId: null,
    effectiveRevisionId: candidate.revisionId, state: current.state === "proposed" ? "active" : current.state, increment: true });
  return { status: "applied", pattern: requirePattern(ctx.db, current) };
}

export function changePatternState(ctx: PatternMutationContext, input: InteractionPatternChangeStateParams): InteractionPatternMutationResult {
  const current = readPattern(ctx.db, input);
  if (ctx.actor.kind === "seed") return refusePattern("forbidden", current);
  const refusal = mutationRefusal(current, input.expectedVersion);
  if (refusal || !current) return refusal ?? refusePattern("not_found");
  const state = { pause: "paused", resume: "active", retire: "retired" } as const;
  const valid = input.action === "retire" ? current.state !== "retired"
    : input.action === "pause" ? current.state === "active" : current.state === "paused";
  if (!valid) return refusePattern("invalid_state", current);
  if (input.action === "resume" && current.effectiveRevision && expiredDefinition(current.effectiveRevision.definition, ctx.at)) {
    return refusePattern("expired", current);
  }
  updatePattern(ctx.db, { pattern: current, at: ctx.at, candidateRevisionId: current.candidateRevision?.revisionId ?? null,
    effectiveRevisionId: current.effectiveRevision?.revisionId ?? null, state: state[input.action], increment: true });
  return { status: "applied", pattern: requirePattern(ctx.db, current) };
}

export function rollbackPattern(ctx: PatternMutationContext, input: InteractionPatternRollbackParams): InteractionPatternMutationResult {
  const current = readPattern(ctx.db, input);
  if (ctx.actor.kind === "seed") return refusePattern("forbidden", current);
  const refusal = mutationRefusal(current, input.expectedVersion);
  if (refusal || !current) return refusal ?? refusePattern("not_found");
  if (current.state === "retired") return refusePattern("invalid_state", current);
  const revision = readPatternRevision(ctx.db, input.revisionId);
  const ownership = ctx.db.prepare("SELECT pattern_id FROM interaction_pattern_revisions WHERE revision_id=:revisionId").get({ revisionId: input.revisionId });
  if (!revision?.acceptedAt || ownership?.pattern_id !== current.patternId) return refusePattern("not_found", current);
  if (expiredDefinition(revision.definition, ctx.at)) return refusePattern("expired", current);
  if (patternRevisionCount(ctx.db, current.patternId) >= 1000) return refusePattern("limit_reached", current);
  insertPatternRevision(ctx.db, { pattern: current, revisionId: randomUUID(), definition: revision.definition,
    origin: { kind: "rollback", description: "Previously accepted parameters copied for a new review." },
    sourceKey: patternDigest([patternActorKey(ctx.actor), input]), authorKey: patternActorKey(ctx.actor),
    sourceRunId: ctx.actor.kind === "agent" ? ctx.actor.runId : null, at: ctx.at, newPattern: false });
  return { status: "applied", pattern: requirePattern(ctx.db, current) };
}

function mutationRefusal(current: InteractionPatternView | null, expectedVersion: number): InteractionPatternMutationResult | null {
  if (!current) return refusePattern("not_found");
  return current.version === expectedVersion ? null : refusePattern("conflict", current);
}

export function expiredDefinition(definition: InteractionPatternProposeParams["definition"], at: string): boolean {
  return definition.lifetime.expiresAt !== null && Date.parse(definition.lifetime.expiresAt) <= Date.parse(at);
}
