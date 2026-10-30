/**
 * INPUT: data-only Companion interaction definitions and immutable domain read projections
 * OUTPUT: strict bounded Pattern conditions, definitions, revisions and current-state schemas
 * POS: shared/protocol — one authority contract; opaque bindings are never presentation content
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
const Timestamp = z.string().datetime({ offset: true });
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Label = z.string().trim().min(1).max(120);

export const InteractionPatternConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local_time_window"),
    start: ClockTime.describe("Opening wall-clock time in the Core-owned User Timezone."),
    end: ClockTime.describe("Closing wall-clock time; an earlier value closes on the next day."),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7)
      .describe("Weekdays on which the window opens, Monday=1 through Sunday=7."),
  }).strict(),
  z.object({ kind: z.literal("application_in_set"), applications: z.array(Label).min(1).max(16)
    .describe("Exact reported application labels; these do not establish work, stress or fatigue.") }).strict(),
  z.object({ kind: z.literal("activity_dwell_at_least"), minutes: z.number().int().min(1).max(1440)
    .describe("Minimum sustained accepted activity duration in minutes.") }).strict(),
  z.object({ kind: z.literal("known_idle_state"), state: z.enum(["active", "idle"])
    .describe("Required known idle state; unavailable idle evidence satisfies neither state.") }).strict(),
  z.object({ kind: z.literal("presence_present") }).strict(),
  z.object({ kind: z.literal("intention_due") }).strict(),
  z.object({ kind: z.literal("completion_of"), runId: Id.describe("Internal reference to a known scoped background Run."),
    label: Label.describe("Readable name of the expected background result; never an internal identifier.") }).strict(),
]);
export type InteractionPatternCondition = z.infer<typeof InteractionPatternConditionSchema>;

export const InteractionPatternContextSelectorSchema = z.enum([
  "memory_global", "memory_character", "accepted_activity", "accepted_screen", "presence",
]);
export type InteractionPatternContextSelector = z.infer<typeof InteractionPatternContextSelectorSchema>;

export const InteractionPatternDefinitionSchema = z.object({
  title: Label.describe("A short readable name for the interaction habit."),
  purpose: z.string().trim().min(1).max(1000).describe("Interaction intent, never fixed dialogue or executable instructions."),
  conditions: z.object({ all: z.array(InteractionPatternConditionSchema).min(1).max(8)
    .describe("Every condition must hold using supported, current source evidence.") }).strict(),
  contextSelectors: z.array(InteractionPatternContextSelectorSchema).max(5)
    .describe("Relevant optional context categories; Persona and existing privacy/authority rules still apply."),
  allowedOutcomes: z.array(z.enum(["silent", "express", "speak"])).min(1).max(3)
    .describe("Permitted interaction outcomes; silent is mandatory and no outcome grants permission."),
  timing: z.object({
    minimumGapMinutes: z.number().int().min(0).max(10080)
      .describe("Minimum time between admitted judgments for this Pattern, including silent judgments; global limits still apply."),
    chance: z.number().min(0).max(1)
      .describe("Deterministic chance per opportunity and accepted revision; never rerolled by waiting or renewal."),
  }).strict(),
  lifetime: z.object({ startsAt: Timestamp.nullable().describe("Inclusive activation instant, or null for no delayed start."),
    expiresAt: Timestamp.nullable().describe("Exclusive final validity instant, or null for an ongoing habit.") }).strict(),
}).strict().superRefine((definition, ctx) => {
  if (JSON.stringify(definition).length > 16384) {
    ctx.addIssue({ code: "custom", message: "The complete definition exceeds the bounded storage contract." });
  }
  if (!definition.allowedOutcomes.includes("silent")) {
    ctx.addIssue({ code: "custom", path: ["allowedOutcomes"], message: "Silence must always be allowed." });
  }
  for (const field of ["contextSelectors", "allowedOutcomes"] as const) {
    if (new Set(definition[field]).size !== definition[field].length) {
      ctx.addIssue({ code: "custom", path: [field], message: "Duplicate values are not allowed." });
    }
  }
  const { startsAt, expiresAt } = definition.lifetime;
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
    ctx.addIssue({ code: "custom", path: ["lifetime"], message: "Expiry must follow activation." });
  }
  definition.conditions.all.forEach((condition, index) => validateCondition(condition, index, ctx));
});
export type InteractionPatternDefinition = z.infer<typeof InteractionPatternDefinitionSchema>;

function validateCondition(condition: InteractionPatternCondition, index: number, ctx: z.RefinementCtx): void {
  const fail = (message: string) => ctx.addIssue({ code: "custom", path: ["conditions", "all", index], message });
  if (condition.kind === "local_time_window") {
    if (condition.start === condition.end) fail("A clock window must have distinct opening and closing times.");
    if (new Set(condition.daysOfWeek).size !== condition.daysOfWeek.length) fail("Weekdays must be unique.");
  }
  if (condition.kind === "application_in_set"
    && new Set(condition.applications.map((name) => name.toLowerCase())).size !== condition.applications.length) {
    fail("Application labels must be unique.");
  }
}

export const InteractionPatternStateSchema = z.enum(["proposed", "active", "paused", "retired"]);
export type InteractionPatternState = z.infer<typeof InteractionPatternStateSchema>;
export const InteractionPatternChangeSchema = z.enum([
  "title", "purpose", "conditions", "contextSelectors", "allowedOutcomes", "timing", "lifetime",
]);
export type InteractionPatternChange = z.infer<typeof InteractionPatternChangeSchema>;
export const InteractionPatternOriginSchema = z.object({
  kind: z.enum(["user", "agent", "seed", "rollback"]),
  description: z.string().min(1).max(240),
}).strict();
export type InteractionPatternOrigin = z.infer<typeof InteractionPatternOriginSchema>;

export const InteractionPatternRevisionSchema = z.object({
  revisionId: Id,
  baseVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  definition: InteractionPatternDefinitionSchema,
  origin: InteractionPatternOriginSchema,
  changes: z.array(InteractionPatternChangeSchema).max(7),
  createdAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
}).strict();
export type InteractionPatternRevision = z.infer<typeof InteractionPatternRevisionSchema>;

export const InteractionPatternViewSchema = z.object({
  patternId: Id,
  characterId: Id,
  state: InteractionPatternStateSchema,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  effectiveRevision: InteractionPatternRevisionSchema.nullable(),
  candidateRevision: InteractionPatternRevisionSchema.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).strict();
export type InteractionPatternView = z.infer<typeof InteractionPatternViewSchema>;
