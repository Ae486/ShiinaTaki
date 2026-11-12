/**
 * INPUT: optional program-supplied material descriptions and known generation identity
 * OUTPUT: source sidecars and scoped material references without executable authority
 * POS: shared/protocol — common retained source meaning for private work and publication readers
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
export const MaterialSourceSchema = z.strictObject({
  label: z.string().min(1).max(1000).optional(),
  reference: z.string().min(1).max(4000).optional(),
  speaker: z.string().min(1).max(1000).optional(),
  time: z.string().min(1).max(1000).optional(),
});
export type MaterialSource = z.infer<typeof MaterialSourceSchema>;
const OptionalSource = MaterialSourceSchema.optional().transform((source) =>
  source && Object.values(source).some((value) => value !== undefined) ? source : undefined);
export const GenerationOriginSchema = z.strictObject({ runId: Id, attemptId: Id, subagentId: z.uuid().optional() });
export type GenerationOrigin = z.infer<typeof GenerationOriginSchema>;
export const SourceContextSchema = z.strictObject({
  generatedBy: GenerationOriginSchema.optional(),
  materials: z.array(MaterialSourceSchema).max(200).optional(),
}).transform(({ generatedBy, materials }) => {
  const known = materials?.filter((source) => Object.values(source).some((value) => value !== undefined));
  return { ...(generatedBy ? { generatedBy } : {}), ...(known?.length ? { materials: known } : {}) };
});
export type SourceContext = z.infer<typeof SourceContextSchema>;
// Preserve original accepted text; oversized input is refused, never silently shortened.
export const ContextMaterialSchema = z.strictObject({
  key: Id, text: z.string().max(1_000_000), source: OptionalSource,
});
export type ContextMaterial = z.infer<typeof ContextMaterialSchema>;
export const ToolSourceMaterialSchema = z.strictObject({ key: Id, source: OptionalSource });
export type ToolSourceMaterial = z.infer<typeof ToolSourceMaterialSchema>;
export const MaterialRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), inputId: z.uuid(), key: Id }),
  z.strictObject({ kind: z.literal("tool_result"), runId: Id, attemptId: Id,
    stepNumber: z.int().nonnegative(), toolCallId: Id, key: Id }),
  z.strictObject({ kind: z.literal("retained_result"), childRunId: Id,
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/), materialIndex: z.int().nonnegative() }),
]);
export type MaterialRef = z.infer<typeof MaterialRefSchema>;
