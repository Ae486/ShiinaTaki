/**
 * INPUT: Core database, trusted actors and strict Pattern commands
 * OUTPUT: one source/CAS/idempotency authority for seeds, primary authoring and operator management
 * POS: core/initiative/patterns — domain composition; publishes invalidation only after committed writes
 */
import { z } from "zod";
import {
  InteractionPatternListParamsSchema, InteractionPatternGetParamsSchema, InteractionPatternHistoryParamsSchema,
  InteractionPatternProposeParamsSchema, InteractionPatternConfirmParamsSchema,
  InteractionPatternChangeStateParamsSchema, InteractionPatternRollbackParamsSchema,
  type InteractionPatternListParams, type InteractionPatternListResult, type InteractionPatternGetParams,
  type InteractionPatternHistoryParams, type InteractionPatternHistoryResult, type InteractionPatternProposeParams,
  type InteractionPatternConfirmParams, type InteractionPatternChangeStateParams, type InteractionPatternRollbackParams,
  type InteractionPatternMutationResult, type InteractionPatternView,
} from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { listPatterns, readPattern, patternHistory, requirePattern } from "./pattern-store.ts";
import { patternDigest, patternActorKey, validatePatternActor, registerPatternPrimarySource,
  type InteractionPatternActor, type InteractionPatternPrimarySource } from "./pattern-source.ts";
import { proposePattern, confirmPattern, changePatternState, rollbackPattern, refusePattern,
  expiredDefinition, type PatternMutationContext } from "./pattern-mutations.ts";

export interface InteractionPatternServiceOptions {
  db: Database;
  now?: () => Date;
  onChanged?: (change: { characterId: string }) => void;
}
export interface InteractionPatternService {
  list(input: InteractionPatternListParams): InteractionPatternListResult;
  get(input: InteractionPatternGetParams): InteractionPatternView | null;
  history(input: InteractionPatternHistoryParams): InteractionPatternHistoryResult;
  listActive(characterId: string): InteractionPatternView[];
  findSeed(characterId: string, seedId: string): InteractionPatternView | null;
  propose(input: InteractionPatternProposeParams, actor: InteractionPatternActor): InteractionPatternMutationResult;
  confirm(input: InteractionPatternConfirmParams, actor: InteractionPatternActor): InteractionPatternMutationResult;
  changeState(input: InteractionPatternChangeStateParams, actor: InteractionPatternActor): InteractionPatternMutationResult;
  rollback(input: InteractionPatternRollbackParams, actor: InteractionPatternActor): InteractionPatternMutationResult;
  registerPrimarySource(input: InteractionPatternPrimarySource): boolean;
  notificationFailures(): number;
}

interface CommandBase { commandId: string; characterId: string; patternId: string | null }
interface MutationOperation<T extends CommandBase> {
  kind: string;
  schema: z.ZodType<T>;
  input: T;
  apply: (ctx: PatternMutationContext, input: T) => InteractionPatternMutationResult;
}

export function createInteractionPatternService(options: InteractionPatternServiceOptions): InteractionPatternService {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  let failures = 0;
  const changed = (characterId: string) => {
    try { options.onChanged?.({ characterId }); }
    catch { failures = Math.min(failures + 1, Number.MAX_SAFE_INTEGER); }
  };
  const mutate = <T extends CommandBase>(operation: MutationOperation<T>, actor: InteractionPatternActor) => {
    const parsed = operation.schema.safeParse(operation.input);
    if (!parsed.success) return refusePattern("invalid_request");
    const input = parsed.data;
    let result: InteractionPatternMutationResult = refusePattern("invalid_request");
    db.transaction(() => {
      const authority = validatePatternActor(db, input.characterId, actor);
      if (authority) { result = refusePattern(authority); return; }
      result = applyCommand({ db, actor, at: now().toISOString() }, { ...operation, input });
    });
    if (result.status === "applied") changed(input.characterId);
    return result;
  };
  return {
    list: (input) => listPatterns(db, InteractionPatternListParamsSchema.parse(input)),
    get: (input) => readPattern(db, InteractionPatternGetParamsSchema.parse(input)),
    history: (input) => patternHistory(db, InteractionPatternHistoryParamsSchema.parse(input)),
    listActive: (characterId) => activePatterns(db, characterId, now().toISOString()),
    findSeed: (characterId, seedId) => findSeed(db, characterId, seedId),
    propose: (input, actor) => mutate({ kind: "propose", schema: InteractionPatternProposeParamsSchema, input, apply: proposePattern }, actor),
    confirm: (input, actor) => mutate({ kind: "confirm", schema: InteractionPatternConfirmParamsSchema, input, apply: confirmPattern }, actor),
    changeState: (input, actor) => mutate({ kind: "change-state", schema: InteractionPatternChangeStateParamsSchema, input, apply: changePatternState }, actor),
    rollback: (input, actor) => mutate({ kind: "rollback", schema: InteractionPatternRollbackParamsSchema, input, apply: rollbackPattern }, actor),
    registerPrimarySource: (input) => registerPatternPrimarySource(db, input),
    notificationFailures: () => failures,
  };
}

function findSeed(db: Database, characterId: string, seedId: string): InteractionPatternView | null {
  const scope = z.object({ characterId: z.string().min(1).max(200), seedId: z.string().min(1).max(200) }).strict().parse({ characterId, seedId });
  const row = db.prepare("SELECT pattern_id FROM interaction_patterns WHERE character_id=:characterId AND seed_key=:seedId").get(scope);
  return row ? readPattern(db, { characterId, patternId: String(row.pattern_id) }) : null;
}

function applyCommand<T extends CommandBase>(ctx: PatternMutationContext, operation: MutationOperation<T>): InteractionPatternMutationResult {
  const input = operation.input;
  const commandKey = patternDigest([patternActorKey(ctx.actor), input.characterId,
    ctx.actor.kind === "agent" ? ctx.actor.toolCallId : input.commandId]);
  const requestDigest = patternDigest([operation.kind, input, ctx.actor.kind === "seed" ? ctx.actor.seedVersion : null]);
  const receipt = ctx.db.prepare("SELECT * FROM interaction_pattern_commands WHERE command_key=:commandKey").get({ commandKey });
  if (receipt) {
    const current = readPattern(ctx.db, { characterId: input.characterId, patternId: String(receipt.pattern_id) });
    if (receipt.request_digest !== requestDigest) return refusePattern("command_conflict", current);
    return current ? { status: "duplicate", pattern: current } : refusePattern("not_found");
  }
  const count = ctx.db.prepare("SELECT count(*) AS count FROM interaction_pattern_commands WHERE character_id=:characterId")
    .get({ characterId: input.characterId });
  if (Number(count?.count) >= 10000) return refusePattern("limit_reached");
  const result = operation.apply(ctx, input);
  if (result.status !== "refused") {
    ctx.db.prepare(`INSERT INTO interaction_pattern_commands(command_key,character_id,request_digest,pattern_id,created_at)
      VALUES(:commandKey,:characterId,:requestDigest,:patternId,:at)`)
      .run({ commandKey, characterId: input.characterId, requestDigest, patternId: result.pattern.patternId, at: ctx.at });
  }
  return result;
}

function activePatterns(db: Database, characterId: string, at: string): InteractionPatternView[] {
  z.string().min(1).max(200).parse(characterId);
  return db.prepare("SELECT pattern_id FROM interaction_patterns WHERE character_id=:characterId AND state='active' ORDER BY pattern_id LIMIT 100")
    .all({ characterId })
    .map((row) => requirePattern(db, { characterId, patternId: String(row.pattern_id) }))
    .filter((pattern) => {
      const revision = pattern.effectiveRevision;
      return revision?.acceptedAt && !expiredDefinition(revision.definition, at)
        && (revision.definition.lifetime.startsAt === null || Date.parse(revision.definition.lifetime.startsAt) <= Date.parse(at));
    });
}
