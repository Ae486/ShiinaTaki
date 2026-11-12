/**
 * INPUT:  candidate connect-handshake params + results (parsed WS frames)
 * OUTPUT: role/handshake schemas, including physical-operator command-display offers and echoes
 * POS:    shared/protocol — the ONLY pre-auth handshake contract (ADR 0004); identity is deviceId, never host/IP
 */
import { z } from "zod";
import { APPROVAL_COMMAND_DISCLOSURE_REVISION } from "./approval-schema.ts";
import { HostDeclarationSchema, HostNegotiationSchema } from "./host-control-schema.ts";

export const CONNECT_METHOD = "connect";

export const RoleSchema = z.enum(["operator", "node"]);
export type Role = z.infer<typeof RoleSchema>;

const LocalAuthHexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** One physical connect socket owns this challenge; it carries no reusable credential. */
export const LocalAuthChallengeSchema = z.object({
  version: z.literal(1),
  coreId: z.uuid(),
  instanceId: z.uuid(),
  endpoint: z.string().url(),
  nonce: LocalAuthHexSchema,
  clientNonce: LocalAuthHexSchema,
  deviceId: z.uuid(),
  role: RoleSchema,
  expiresAt: z.number().int().positive().safe(),
  serverProof: LocalAuthHexSchema,
}).strict();
export type LocalAuthChallenge = z.infer<typeof LocalAuthChallengeSchema>;

/** Canonical cross-language HMAC input; both domains bind the exact same physical-socket identity. */
export function localAuthTranscript(side: "server" | "client", challenge: Omit<LocalAuthChallenge, "serverProof">): string {
  const fields = JSON.stringify([challenge.version, challenge.coreId, challenge.instanceId, challenge.endpoint,
    challenge.nonce, challenge.clientNonce, challenge.deviceId, challenge.role, challenge.expiresAt]);
  return `taki-local-auth-v1:${side}\n${fields}`;
}

export const LocalAuthRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("begin"), clientNonce: LocalAuthHexSchema }).strict(),
  z.object({ kind: z.literal("proof"), nonce: LocalAuthHexSchema, proof: LocalAuthHexSchema }).strict(),
]);
export type LocalAuthRequest = z.infer<typeof LocalAuthRequestSchema>;

export const ConnectParamsSchema = z
  .object({
    deviceId: z.uuid(),
    deviceName: z.string().min(1),
    role: RoleSchema,
    capabilities: z.array(z.string()).default([]),
    token: z.string().optional(),
    pairingCode: z.string().optional(),
    localAuth: LocalAuthRequestSchema.optional(),
    host: HostDeclarationSchema.optional(),
    approvalCommandDisclosureRevision: z.literal(APPROVAL_COMMAND_DISCLOSURE_REVISION).optional(),
  })
  // Operators converse/configure; they never provide capabilities (topology invariant, ADR 0004).
  .refine((params) => params.role !== "operator" || params.capabilities.length === 0, {
    message: "operators must not declare capabilities",
    path: ["capabilities"],
  })
  .refine((params) => params.role !== "operator" || params.host === undefined, {
    message: "operators must not declare an execution host",
    path: ["host"],
  })
  .refine((params) => params.role !== "node" || params.host !== undefined, {
    message: "nodes must declare host protocol support",
    path: ["host"],
  })
  .refine((params) => params.role === "operator" || params.approvalCommandDisclosureRevision === undefined, {
    message: "command display support is operator-only",
    path: ["approvalCommandDisclosureRevision"],
  })
  .refine((params) => params.localAuth === undefined || (params.pairingCode === undefined
    && (params.localAuth.kind !== "begin" || params.token === undefined)), {
    message: "local authentication begins without reusable credentials or pairing codes",
    path: ["localAuth"],
  });
export type ConnectParams = z.infer<typeof ConnectParamsSchema>;

export const ConnectResultSchema = z.object({
  status: z.literal("ok"),
  // Present once: in the result of a connect that just minted a token — via completed pairing OR loopback auto-trust (#16 P3).
  token: z.string().optional(),
  host: HostNegotiationSchema.optional(),
  approvalCommandDisclosureRevision: z.literal(APPROVAL_COMMAND_DISCLOSURE_REVISION).optional(),
}).refine((result) => result.host === undefined || result.approvalCommandDisclosureRevision === undefined, {
  message: "execution hosts do not negotiate operator command display",
  path: ["approvalCommandDisclosureRevision"],
});
export type ConnectResult = z.infer<typeof ConnectResultSchema>;
