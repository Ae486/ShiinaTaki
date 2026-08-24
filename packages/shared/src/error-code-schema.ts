/**
 * INPUT:  a candidate error-code string
 * OUTPUT: ErrorCodeSchema — the closed ErrorCode union (provider/internal + auth/dispatch codes)
 * POS:    shared/protocol — cross-process error-code vocabulary; extend HERE only, never inline strings
 */
import { z } from "zod";
export const ErrorCodeSchema = z.enum([
  "PROVIDER_ERROR",
  "INTERNAL_ERROR",
  // Auth/dispatch failures (ADR 0004): ride error.data.code on a JSON_RPC_APP_ERROR response.
  "PAIRING_REQUIRED",
  "AUTH_FAILED",
  "NOT_AUTHENTICATED",
  "ALREADY_CONNECTED",
  "FORBIDDEN",
  // A config.set the store refuses on its own terms (secret / env-locked / env-only / unknown key / bad value);
  // the machine-readable ConfigRefusalReason rides error.data.reason beside this code.
  "CONFIG_REFUSED",
  // A secret.set/clear the catalog service refuses on its own terms (locked / unreadable / unsupported store);
  // the machine-readable SecretRefusalReason rides error.data.reason beside this code.
  "SECRET_REFUSED",
  "POLICY_CONFLICT",
  "GOVERNANCE_REFUSED",
  // A desired-state mcp.* write the MCP lifecycle refuses on its own terms (unknown/duplicate/key-collision/
  // invalid config); the machine-readable McpRefusalReason rides error.data.reason beside this code.
  "MCP_REFUSED",
  // An mcp.* write whose expectedConfigRevision no longer matches the desired row; error.data.currentConfigRevision
  // carries the row's current revision so the operator surface can refetch and retry explicitly (never replay).
  "MCP_CONFIG_CONFLICT",
  "SKILL_REFUSED",
  "SKILL_CONFIG_CONFLICT",
  // Operator-only Hindsight setup refuses a request before/while reaching the external service. The bounded
  // HindsightError code rides error.data.reason; raw HTTP/provider/secret details never do.
  "HINDSIGHT_REFUSED",
  // Tool execution outcomes are structured model-readable failures, not JSON-RPC envelope codes.
  "GOVERNANCE_DENIED",
  "APPROVAL_REQUIRED",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
