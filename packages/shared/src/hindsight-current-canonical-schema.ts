/**
 * INPUT:  raw-backed current Canonical state with arbitrary legal JSON own keys
 * OUTPUT: existing Canonical contracts with lossless JSON field validators for D78 capture and wire
 * POS:    shared current-state adapter — legacy Canonical/G1 schemas and frozen hashes remain untouched
 */
import { z } from "zod";
import { CanonicalMemoryBankSchema, CanonicalMemorySourceSchema, CanonicalMemoryUnitSchema, CanonicalMemoryRecordSchema,
  CanonicalDerivedMemorySchema, CanonicalDerivedPayloadSchema } from "./memory-provider-domain-schema.ts";
import { createHindsightJsonSchemas } from "./hindsight-json-schema.ts";

const json = createHindsightJsonSchemas(16_384);
export const HindsightCurrentJsonValueSchema = json.value;
export const HindsightCurrentJsonObjectSchema = json.object;
export const HindsightCurrentCanonicalBankSchema = CanonicalMemoryBankSchema.safeExtend({ config: json.object });
export const HindsightCurrentCanonicalSourceSchema = CanonicalMemorySourceSchema.safeExtend({ metadata: json.object });
export const HindsightCurrentCanonicalUnitSchema = CanonicalMemoryUnitSchema.safeExtend({ metadata: json.object });
export const HindsightCurrentCanonicalRecordSchema = CanonicalMemoryRecordSchema.safeExtend({ unit: HindsightCurrentCanonicalUnitSchema });
export const HindsightCurrentCanonicalDerivedPayloadSchema = z.discriminatedUnion("kind", [
  CanonicalDerivedPayloadSchema.options[0].safeExtend({ trigger: json.object.nullable(),
    reflectResponse: json.object.nullable(), structuredContent: json.object.nullable() }),
  CanonicalDerivedPayloadSchema.options[1],
]);
export const HindsightCurrentCanonicalDerivedSchema = CanonicalDerivedMemorySchema.safeExtend({ payload: HindsightCurrentCanonicalDerivedPayloadSchema });
