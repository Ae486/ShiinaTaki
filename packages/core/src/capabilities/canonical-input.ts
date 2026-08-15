/**
 * INPUT:  validated capability identity and exact JSON-compatible input
 * OUTPUT: canonicalCapabilityInput() + lowercase SHA-256 capabilityInputDigest()
 * POS:    core/capabilities — sealed dispatch identity; model/content never supplies the digest
 */
import { createHash } from "node:crypto";

export function capabilityInputDigest(capabilityId: string, input: unknown): string {
  return createHash("sha256").update(canonicalCapabilityInput(capabilityId, input), "utf8").digest("hex");
}

export function canonicalCapabilityInput(capabilityId: string, input: unknown): string {
  const normalized = JSON.parse(JSON.stringify({ capabilityId, input })) as unknown;
  return canonicalJson(normalized);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("capability input is not JSON-compatible");
}
