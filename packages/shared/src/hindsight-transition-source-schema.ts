/**
 * INPUT: exact transition executor and immutable D77 Source upload descriptors/parts
 * OUTPUT: additive source-evidence capability and executor-owned staging request schemas
 * POS: shared transition source extension — preserves legacy D77 and transition request serialization
 */
import { z } from "zod";
import { TakiApplicationBodyUploadRequestSchema, TakiApplicationBodyPartRequestSchema } from "./hindsight-application-body-schema.ts";
import { HindsightTransitionExecutorSchema } from "./hindsight-transition-schema.ts";

export const HINDSIGHT_TRANSITION_SOURCE_EVIDENCE_VERSION = "1.0.0" as const;
export const HindsightTransitionSourceUploadSchema = TakiApplicationBodyUploadRequestSchema.extend({ executor: HindsightTransitionExecutorSchema })
  .refine((value) => value.descriptor.body_schema === "application-source.v1", "Transition upload requires Source input");
export const HindsightTransitionSourcePartSchema = TakiApplicationBodyPartRequestSchema.extend({ executor: HindsightTransitionExecutorSchema });
export type HindsightTransitionSourceUpload = z.infer<typeof HindsightTransitionSourceUploadSchema>;
export type HindsightTransitionSourcePart = z.infer<typeof HindsightTransitionSourcePartSchema>;
