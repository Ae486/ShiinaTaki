/**
 * INPUT:  validated capability identity and exact JSON-compatible input
 * OUTPUT: canonicalCapabilityInput() + lowercase SHA-256 capabilityInputDigest()
 * POS:    core/capabilities — sealed dispatch identity; model/content never supplies the digest
 */
import { createHash } from "node:crypto";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
export { canonicalCapabilityInput };

export function capabilityInputDigest(capabilityId: string, input: unknown): string {
  return createHash("sha256").update(canonicalCapabilityInput(capabilityId, input), "utf8").digest("hex");
}
