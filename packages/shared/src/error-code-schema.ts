/**
 * INPUT:  a candidate error-code string
 * OUTPUT: ErrorCodeSchema — the closed ErrorCode union (PROVIDER_ERROR | INTERNAL_ERROR)
 * POS:    shared/protocol — cross-process error-code vocabulary; extend HERE only, never inline strings
 */
import { z } from "zod";
export const ErrorCodeSchema = z.enum(["PROVIDER_ERROR", "INTERNAL_ERROR"]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
