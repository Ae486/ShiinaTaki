/**
 * INPUT:  candidate connect-handshake params + results (parsed WS frames)
 * OUTPUT: RoleSchema, ConnectParamsSchema/ConnectResultSchema (+types), CONNECT_METHOD
 * POS:    shared/protocol — the ONLY pre-auth handshake contract (ADR 0004); identity is deviceId, never host/IP
 */
import { z } from "zod";

export const CONNECT_METHOD = "connect";

export const RoleSchema = z.enum(["operator", "node"]);
export type Role = z.infer<typeof RoleSchema>;

export const ConnectParamsSchema = z
  .object({
    deviceId: z.uuid(),
    deviceName: z.string().min(1),
    role: RoleSchema,
    capabilities: z.array(z.string()).default([]),
    token: z.string().optional(),
    pairingCode: z.string().optional(),
  })
  // Operators converse/configure; they never provide capabilities (topology invariant, ADR 0004).
  .refine((params) => params.role !== "operator" || params.capabilities.length === 0, {
    message: "operators must not declare capabilities",
    path: ["capabilities"],
  });
export type ConnectParams = z.infer<typeof ConnectParamsSchema>;

export const ConnectResultSchema = z.object({
  status: z.literal("ok"),
  // Present once: in the result of a connect that just minted a token — via completed pairing OR loopback auto-trust (#16 P3).
  token: z.string().optional(),
});
export type ConnectResult = z.infer<typeof ConnectResultSchema>;
