/**
 * INPUT:  operator model-capability reads and the Core's safe configured-model projection.
 * OUTPUT: MODEL_CAPABILITIES_METHOD + request/result schemas with distinct catalog and adapter evidence.
 * POS:    Shared operator protocol — declarations never certify an endpoint or govern native image transport.
 */
import { z } from "zod";

export const MODEL_CAPABILITIES_METHOD = "config.modelCapabilities";
export const ModelCapabilitiesParamsSchema = z.object({});
export type ModelCapabilitiesParams = z.infer<typeof ModelCapabilitiesParamsSchema>;

const CatalogDeclarationSchema = z.object({
  status: z.literal("declared"),
  source: z.literal("models.dev"),
  provider: z.string().min(1),
  model: z.string().min(1),
  fetchedAt: z.string().min(1),
  lastUpdated: z.string().nullable(),
  toolCalling: z.boolean().nullable(),
  imageInput: z.boolean().nullable(),
  metadata: z.object({
    displayName: z.string().min(1).nullable(),
    providerName: z.string().min(1).nullable(),
    canonicalModelId: z.string().min(1).nullable(),
    logoUrl: z.string().regex(/^https:\/\/models\.dev\/logos\/[^/?#]+\.svg$/).nullable(),
    reasoning: z.boolean().nullable(),
    inputModalities: z.array(z.string()).nullable(),
    outputModalities: z.array(z.string()).nullable(),
    contextLimit: z.number().int().nonnegative().nullable(),
    outputLimit: z.number().int().nonnegative().nullable(),
  }).optional(),
});

export const ModelCapabilitiesResultSchema = z.object({
  configured: z.object({ model: z.string().nullable(), identity: z.string().regex(/^[a-f0-9]{64}$/) }),
  apply: z.literal("restart"),
  adapter: z.object({
    kind: z.literal("openai-compatible"),
    toolCalling: z.literal(true),
    imageInput: z.literal(true),
    nativeWebSearch: z.literal(false),
  }),
  catalog: z.discriminatedUnion("status", [
    CatalogDeclarationSchema,
    z.object({ status: z.literal("unknown"), reason: z.enum(["unconfigured", "endpoint", "model"]) }),
    z.object({ status: z.literal("unavailable") }),
  ]),
});
export type ModelCapabilitiesResult = z.infer<typeof ModelCapabilitiesResultSchema>;
