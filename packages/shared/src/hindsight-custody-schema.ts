/**
 * INPUT:  admitted Hindsight credential selection and bounded non-secret Host preparation frames
 * OUTPUT: strict C1 v1 request/result schemas and the seven fixed catalog references
 * POS:    shared/protocol — custody preparation never conveys secret values or deployment readiness
 */
import { z } from "zod";
import { HostOperationControlSchema, CapabilityAuthorizationLineageSchema } from "./host-control-schema.ts";

export const HINDSIGHT_CUSTODY_CAPABILITY = "hindsight-custody";
export const HINDSIGHT_CUSTODY_CELL = "hindsight-custody:prepare";
export const HINDSIGHT_CUSTODY_LIMITS = {
  requestBytes: 32 * 1024,
  resultBytes: 16 * 1024,
  envelopeBytes: 16 * 1024 * 1024,
  valueCodeUnits: 65_536,
  privateFrameBytes: 4 * 1024 * 1024,
  keyCallMs: 10_000,
} as const;

export const HINDSIGHT_SECRET_REFS = {
  connectionApiKey: "memory.hindsight.connection.api-key",
  defaultModelApiKey: "memory.hindsight.model.default.api-key",
  retainModelApiKey: "memory.hindsight.model.retain.api-key",
  reflectModelApiKey: "memory.hindsight.model.reflect.api-key",
  consolidationModelApiKey: "memory.hindsight.model.consolidation.api-key",
  embeddingApiKey: "memory.hindsight.model.embedding.api-key",
  rerankerApiKey: "memory.hindsight.model.reranker.api-key",
} as const;

export const HindsightCustodyDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const HindsightCredentialSlotSchema = z.enum(Object.keys(HINDSIGHT_SECRET_REFS) as [keyof typeof HINDSIGHT_SECRET_REFS, ...Array<keyof typeof HINDSIGHT_SECRET_REFS>]);
export type HindsightCredentialSlot = z.infer<typeof HindsightCredentialSlotSchema>;
const inheritedSlot = z.enum(["retainModelApiKey", "reflectModelApiKey", "consolidationModelApiKey"]);
const unusedSlot = z.enum(["retainModelApiKey", "reflectModelApiKey", "consolidationModelApiKey", "embeddingApiKey", "rerankerApiKey"]);
const inherited = z.strictObject({ slot: inheritedSlot, source: z.literal("inherit-default") });
const unused = z.strictObject({ slot: unusedSlot, source: z.literal("unused") });

const fixedSelection = z.discriminatedUnion("source", [
  z.strictObject({ slot: HindsightCredentialSlotSchema, source: z.literal("catalog") }), inherited, unused,
]);
const selectedEntry = z.discriminatedUnion("source", [
  z.strictObject({ slot: HindsightCredentialSlotSchema, source: z.literal("catalog"), updatedAt: z.iso.datetime({ offset: true }) }), inherited, unused,
]);

function validSelection(selection: Array<{ slot: string; source: string }>): boolean {
  return new Set(selection.map((entry) => entry.slot)).size === selection.length
    && (!selection.some((entry) => entry.source === "inherit-default")
      || selection.some((entry) => entry.slot === "defaultModelApiKey" && entry.source === "catalog"));
}

export const HindsightFixedSelectionSchema = z.array(fixedSelection).min(1).max(7).refine(validSelection, "invalid fixed selection");
export const HindsightSelectedEntriesSchema = z.array(selectedEntry).min(1).max(7).refine(validSelection, "invalid fixed selection");
export type HindsightFixedSelection = z.infer<typeof HindsightFixedSelectionSchema>;
export type HindsightSelectedEntries = z.infer<typeof HindsightSelectedEntriesSchema>;

export const HindsightCustodyPrepareSchema = z.strictObject({
  version: z.literal(1),
  snapshotId: z.uuid(),
  coreBootId: z.uuid(),
  coreHostId: z.uuid(),
  catalogStoreId: z.uuid(),
  catalogKeyVersion: z.number().int().positive(),
  sealedEnvelopeSha256: HindsightCustodyDigestSchema,
  installationId: HindsightCustodyDigestSchema,
  configurationDigest: HindsightCustodyDigestSchema,
  selection: HindsightSelectedEntriesSchema,
});
export type HindsightCustodyPrepare = z.infer<typeof HindsightCustodyPrepareSchema>;

export const HindsightTrustedInvocationSchema = z.strictObject({
  version: z.literal(1),
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  authorization: CapabilityAuthorizationLineageSchema.optional(),
  owner: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("windows-token"), tokenUserSha256: HindsightCustodyDigestSchema }),
    z.strictObject({ kind: z.literal("unix-user"), uid: z.number().int().nonnegative() }),
  ]),
  input: HindsightCustodyPrepareSchema,
}).refine((value) => value.control.capabilityId === HINDSIGHT_CUSTODY_CAPABILITY, "wrong custody capability");
export type HindsightTrustedInvocation = z.infer<typeof HindsightTrustedInvocationSchema>;

export const HindsightCustodyRefusalSchema = z.enum([
  "unsupported-installation", "unsafe-installation", "host-unavailable", "custody-locked",
  "input-oversize", "snapshot-stale", "outcome-unknown", "approval-required", "denied",
]);
export type HindsightCustodyRefusal = z.infer<typeof HindsightCustodyRefusalSchema>;
export const HindsightCustodyResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    version: z.literal(1), state: z.literal("prepared"), snapshotId: z.uuid(),
    requestId: z.uuid(), hostAttemptId: z.uuid(), installationId: HindsightCustodyDigestSchema,
    sealedEnvelopeSha256: HindsightCustodyDigestSchema, configurationDigest: HindsightCustodyDigestSchema,
    // Preparation proves a read. No C1 response can be consumed as deployment or injection authority.
    deploymentReady: z.literal(false),
  }),
  z.strictObject({ version: z.literal(1), state: z.literal("unavailable"), reason: HindsightCustodyRefusalSchema, deploymentReady: z.literal(false) }),
]);
export type HindsightCustodyResult = z.infer<typeof HindsightCustodyResultSchema>;

export const HINDSIGHT_CUSTODY_METHODS = { prepare: "memory.hindsight.custody.prepare" } as const;
export const HindsightCustodyParamsSchema = z.strictObject({});
