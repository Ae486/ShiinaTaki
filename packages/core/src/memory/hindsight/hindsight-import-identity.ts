/**
 * INPUT:  domain-separated B2 import or Pending Memory operation identity strings
 * OUTPUT: deterministic RFC 4122 UUIDs accepted by Hindsight async retain
 * POS:    core/memory/hindsight — frozen UUID protocol adapter; the caller's original identity remains durable audit evidence
 */
import { createHash } from "node:crypto";

export function hindsightOperationUuid(operationIdentity: string): string {
  const bytes = createHash("sha256").update("hindsight-operation-uuid/v1\0").update(operationIdentity).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
