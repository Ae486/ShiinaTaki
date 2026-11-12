/**
 * INPUT: verified Source/native heads and exact per-unit policy at retain completion
 * OUTPUT: bounded immutable evidence for later source-dependent initiative currentness
 * POS: core/memory/hindsight — internal journal codec; never a model-facing result or a predicted native revision
 */
import { z } from "zod";
import { TakiMemoryPolicyProjectionSchema, TakiApplicationNativeHeadSchema } from "@taki/shared";

export const HindsightSourceLifetimeSchema = z.strictObject({
  sourceBinding: TakiApplicationNativeHeadSchema,
  memoryBindings: z.array(z.strictObject({ policy: TakiMemoryPolicyProjectionSchema,
    head: TakiApplicationNativeHeadSchema })).max(256),
});
export type HindsightSourceLifetime = z.infer<typeof HindsightSourceLifetimeSchema>;
