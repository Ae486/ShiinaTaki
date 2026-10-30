/**
 * INPUT: authenticated operator requests or Core-bound primary authoring commands
 * OUTPUT: strict Pattern query/mutation protocol and typed readable refusal results
 * POS: shared/protocol — command bindings convey no permission or reviewer authority
 */
import { z } from "zod";
import { InteractionPatternDefinitionSchema, InteractionPatternRevisionSchema, InteractionPatternViewSchema } from "./interaction-pattern-schema.ts";

const Id = z.string().min(1).max(200);
const Version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Scope = { characterId: Id, patternId: Id };
const Mutation = { ...Scope, commandId: Id, expectedVersion: Version };

export const INTERACTION_PATTERN_METHODS = {
  list: "interaction-pattern.list",
  get: "interaction-pattern.get",
  history: "interaction-pattern.history",
  propose: "interaction-pattern.propose",
  confirm: "interaction-pattern.confirm",
  changeState: "interaction-pattern.change-state",
  rollback: "interaction-pattern.rollback",
  changed: "interaction-pattern.changed",
} as const;

export const InteractionPatternListParamsSchema = z.object({
  characterId: Id,
  after: Id.nullable(),
  limit: z.number().int().min(1).max(100),
}).strict();
export type InteractionPatternListParams = z.infer<typeof InteractionPatternListParamsSchema>;
export const InteractionPatternListResultSchema = z.object({
  patterns: z.array(InteractionPatternViewSchema).max(100),
  nextAfter: Id.nullable(),
}).strict();
export type InteractionPatternListResult = z.infer<typeof InteractionPatternListResultSchema>;
export const InteractionPatternGetParamsSchema = z.object(Scope).strict();
export type InteractionPatternGetParams = z.infer<typeof InteractionPatternGetParamsSchema>;
export const InteractionPatternGetResultSchema = z.object({ pattern: InteractionPatternViewSchema.nullable() }).strict();
export type InteractionPatternGetResult = z.infer<typeof InteractionPatternGetResultSchema>;
export const InteractionPatternHistoryParamsSchema = z.object({
  ...Scope,
  before: Version.nullable(),
  limit: z.number().int().min(1).max(100),
}).strict();
export type InteractionPatternHistoryParams = z.infer<typeof InteractionPatternHistoryParamsSchema>;
export const InteractionPatternHistoryResultSchema = z.object({
  revisions: z.array(InteractionPatternRevisionSchema).max(100),
  nextBefore: Version.nullable(),
}).strict();
export type InteractionPatternHistoryResult = z.infer<typeof InteractionPatternHistoryResultSchema>;

export const InteractionPatternProposeParamsSchema = z.object({
  characterId: Id,
  commandId: Id,
  patternId: Id.nullable(),
  expectedVersion: Version,
  definition: InteractionPatternDefinitionSchema,
}).strict();
export type InteractionPatternProposeParams = z.infer<typeof InteractionPatternProposeParamsSchema>;
export const InteractionPatternConfirmParamsSchema = z.object({ ...Mutation, candidateRevisionId: Id }).strict();
export type InteractionPatternConfirmParams = z.infer<typeof InteractionPatternConfirmParamsSchema>;
export const InteractionPatternChangeStateParamsSchema = z.object({
  ...Mutation, action: z.enum(["pause", "resume", "retire"]),
}).strict();
export type InteractionPatternChangeStateParams = z.infer<typeof InteractionPatternChangeStateParamsSchema>;
export const InteractionPatternRollbackParamsSchema = z.object({ ...Mutation, revisionId: Id }).strict();
export type InteractionPatternRollbackParams = z.infer<typeof InteractionPatternRollbackParamsSchema>;

export const InteractionPatternRefusalReasonSchema = z.enum([
  "invalid_request", "not_found", "conflict", "invalid_state", "source_unavailable", "source_stale",
  "forbidden", "expired", "limit_reached", "command_conflict",
]);
export type InteractionPatternRefusalReason = z.infer<typeof InteractionPatternRefusalReasonSchema>;
export const InteractionPatternMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("applied"), pattern: InteractionPatternViewSchema }).strict(),
  z.object({ status: z.literal("duplicate"), pattern: InteractionPatternViewSchema }).strict(),
  z.object({ status: z.literal("refused"), reason: InteractionPatternRefusalReasonSchema, current: InteractionPatternViewSchema.nullable() }).strict(),
]);
export type InteractionPatternMutationResult = z.infer<typeof InteractionPatternMutationResultSchema>;
export const InteractionPatternChangedSchema = z.object({ characterId: Id }).strict();
export type InteractionPatternChanged = z.infer<typeof InteractionPatternChangedSchema>;
