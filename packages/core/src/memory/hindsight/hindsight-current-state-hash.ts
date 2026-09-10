/**
 * INPUT:  versioned structured transfer values and exact target Bank identities
 * OUTPUT: native-compatible SHA-256 request/result/page fingerprints
 * POS:    core/memory/hindsight — D78 proof hashing; existing frozen codecs stay independent
 */
import { createHash } from "node:crypto";
import { hindsightCurrentStateJson, type HindsightCurrentTransferRequest } from "@taki/shared";

export function hindsightCurrentStateHash(value: unknown): string {
  return createHash("sha256").update(hindsightCurrentStateJson(value), "utf8").digest("hex");
}

export function hindsightCurrentRequestHash(bankId: string, request: HindsightCurrentTransferRequest): string {
  const body = currentStateFieldsWithout(request, ["request_hash"]);
  return hindsightCurrentStateHash({ domain: "current-state-request.v1", bank_id: bankId, request: body });
}

export function currentStateFieldsWithout(value: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
