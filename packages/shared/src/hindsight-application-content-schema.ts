/**
 * INPUT:  a sealed body schema identifier and decoded complete JSON bytes
 * OUTPUT: the matching typed application body without treating arbitrary JSON as another protocol
 * POS:    shared application-state body dispatch — validates originals independently from their transport checksum
 */
import { z } from "zod";
import { TakiApplicationBankBodySchema, TakiApplicationSourceBodySchema, TakiApplicationBlockBodySchema,
  TakiApplicationCommandsSchema, TakiApplicationAffectedVersionsSchema } from "./hindsight-application-artifact-schema.ts";
import { TakiApplicationMemoryBodySchema } from "./memory-policy-assessment-schema.ts";
import { TakiApplicationNativeRecordSchema, TakiApplicationNativeSourceEvidenceSchema } from "./hindsight-application-native-schema.ts";
import { TakiApplicationReadContextSchema, TakiApplicationRecordPageSchema } from "./hindsight-application-read-schema.ts";
import type { TakiApplicationBodySchema } from "./hindsight-application-primitives-schema.ts";

export const TakiApplicationBodyContentSchema = z.discriminatedUnion("body_schema", [
  z.strictObject({ body_schema: z.literal("application-bank.v1"), value: TakiApplicationBankBodySchema }),
  z.strictObject({ body_schema: z.literal("application-source.v1"), value: TakiApplicationSourceBodySchema }),
  z.strictObject({ body_schema: z.literal("application-memory.v1"), value: TakiApplicationMemoryBodySchema }),
  z.strictObject({ body_schema: z.literal("application-block.v1"), value: TakiApplicationBlockBodySchema }),
  z.strictObject({ body_schema: z.literal("application-commands.v1"), value: TakiApplicationCommandsSchema }),
  z.strictObject({ body_schema: z.literal("application-affected-versions.v1"), value: TakiApplicationAffectedVersionsSchema }),
  z.strictObject({ body_schema: z.literal("application-native-record.v1"), value: TakiApplicationNativeRecordSchema }),
  z.strictObject({ body_schema: z.literal("application-native-source.v1"), value: TakiApplicationNativeSourceEvidenceSchema }),
  z.strictObject({ body_schema: z.literal("application-read-context.v1"), value: TakiApplicationReadContextSchema }),
  z.strictObject({ body_schema: z.literal("application-record-page.v1"), value: TakiApplicationRecordPageSchema }),
]);
export type TakiApplicationBodyContent = z.infer<typeof TakiApplicationBodyContentSchema>;

export function parseTakiApplicationBody(bodySchema: TakiApplicationBodySchema, value: unknown): TakiApplicationBodyContent {
  return TakiApplicationBodyContentSchema.parse({ body_schema: bodySchema, value });
}
