/**
 * INPUT:  Shared provider capabilities and admission-time memory authority references
 * OUTPUT: detached immutable snapshots, one canonical capability digest for Runs, tools, and dispatch, and the write-time
 *         capability comparison
 * POS:    core/memory — process-local contract helper; dynamic vector health never rewrites admission evidence
 */
import { createHash } from "node:crypto";
import { MemoryProviderCapabilitiesSchema, type MemoryProviderCapabilities, type RunMemoryReference } from "@taki/shared";

export function freezeMemoryCapabilities(value: MemoryProviderCapabilities): MemoryProviderCapabilities {
  // The Shared capability schema is flat. Parsing detaches provider-owned objects before freezing them.
  return Object.freeze(MemoryProviderCapabilitiesSchema.parse(value));
}

export function memoryCapabilityDigest(value: MemoryProviderCapabilities): string {
  return createHash("sha256").update(canonicalCapabilities(value)).digest("hex");
}

export function sameMemoryCapabilities(left: MemoryProviderCapabilities, right: MemoryProviderCapabilities): boolean {
  return canonicalCapabilities(left) === canonicalCapabilities(right);
}

export function sameStableMemoryCapabilities(left: MemoryProviderCapabilities, right: MemoryProviderCapabilities): boolean {
  return canonicalCapabilities(left, true) === canonicalCapabilities(right, true);
}

/** A write admitted under weaker vector health may run once it is ready; any other change, including a weaker state, is drift. */
export function writableMemoryCapabilities(admitted: MemoryProviderCapabilities, current: MemoryProviderCapabilities): boolean {
  return sameStableMemoryCapabilities(admitted, current)
    && (current.vectorRetrieval === admitted.vectorRetrieval || current.vectorRetrieval === "ready");
}

export function createMemoryRunReference(input: Omit<RunMemoryReference, "capabilityDigest">): RunMemoryReference {
  const capabilities = Object.isFrozen(input.capabilities) ? input.capabilities : freezeMemoryCapabilities(input.capabilities);
  if (input.providerId !== capabilities.providerId || input.contractVersion !== capabilities.contractVersion) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return Object.freeze({ ...input, capabilities, capabilityDigest: memoryCapabilityDigest(capabilities) });
}

function canonicalCapabilities(value: MemoryProviderCapabilities, stableOnly = false): string {
  const keys = Object.keys(value).filter((key) => !stableOnly || key !== "vectorRetrieval").sort();
  const record = value as unknown as Record<string, unknown>;
  return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(record[key])}`).join(",")}}`;
}
