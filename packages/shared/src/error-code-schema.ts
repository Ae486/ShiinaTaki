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
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
