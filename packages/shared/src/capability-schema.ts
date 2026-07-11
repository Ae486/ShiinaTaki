/**
 * INPUT:  candidate capability.request notification params + capability.respond request params/results
 * OUTPUT: CAPABILITY_METHODS + CapabilityRequest/Respond/Output/error schemas (+types)
 * POS:    shared/protocol — the core↔node capability channel contract (M3); mirrored in Rust via serde (invariant 3)
 */
import { z } from "zod";

export const CAPABILITY_METHODS = {
  // Core -> node as a notification (no id; correlated by requestId, mirror of approval.request).
  request: "capability.request",
  // Node -> core as a normal request (node-role method), settling the pending request by requestId.
  respond: "capability.respond",
} as const;

// capability is an open string (new capabilities are new modules, invariant 7); input is per-capability args.
// strictObject so a notification carrying an unexpected key is rejected in lockstep with the serde deny_unknown_fields mirror.
export const CapabilityRequestSchema = z.strictObject({
  requestId: z.uuid(),
  capability: z.string().min(1),
  input: z.unknown(),
});
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

// Closed wire error union shared with the Rust node: a denial, a failed execution, or an unknown capability.
export const CapabilityErrorCodeSchema = z.enum(["DENIED", "EXEC_FAILED", "UNSUPPORTED_CAPABILITY"]);
export type CapabilityErrorCode = z.infer<typeof CapabilityErrorCodeSchema>;

export const CapabilityErrorSchema = z.strictObject({
  code: CapabilityErrorCodeSchema,
  message: z.string(),
});
export type CapabilityError = z.infer<typeof CapabilityErrorSchema>;

// Two arms discriminated by ok: success carries an OPAQUE output payload (Option A — each capability owns its own
// output schema in capability-outputs.ts and .parse()s it), failure carries a closed-union error. `output` is
// z.unknown() symmetric with `input` above, so adding a capability never touches this channel schema (invariant 7).
export const CapabilityRespondParamsSchema = z.discriminatedUnion("ok", [
  z.strictObject({ requestId: z.uuid(), ok: z.literal(true), output: z.unknown() }),
  z.strictObject({ requestId: z.uuid(), ok: z.literal(false), error: CapabilityErrorSchema }),
]);
export type CapabilityRespondParams = z.infer<typeof CapabilityRespondParamsSchema>;

// accepted:false is the normal answer to an unknown/late respond (the request already timed out) — never an error.
export const CapabilityRespondResultSchema = z.object({ accepted: z.boolean() });
export type CapabilityRespondResult = z.infer<typeof CapabilityRespondResultSchema>;
