/**
 * INPUT:  a canonical tool and the admission-captured memory authority/capability references
 * OUTPUT: immutable process-local Effect metadata and deterministic branch request identities
 * POS:    core/memory/canonical-tools — trusted sidecar; model input cannot alter authority references
 */
import { createHash } from "node:crypto";
import type { MemoryProviderCapabilities } from "@taki/shared";
import type { Tool } from "ai";
import { freezeMemoryCapabilities, memoryCapabilityDigest } from "../memory-capability-snapshot.ts";

export type ExplicitMemoryOperation = "retain" | "recall" | "reflect" | "edit" | "invalidate" | "restore";

export interface MemoryEffectToolMetadata {
  operation: ExplicitMemoryOperation;
  authorityEpochId: string;
  providerId: string;
  providerLineageId: string;
  capabilities: MemoryProviderCapabilities;
  capabilityDigest: string;
  replayPosture: "safe" | "never";
}

const MEMORY_EFFECT_TOOL = Symbol("taki.memory-effect-tool");

export function attachMemoryEffectMetadata(tool: Tool, metadata: Omit<MemoryEffectToolMetadata, "capabilityDigest">): Tool {
  const capabilities = Object.isFrozen(metadata.capabilities) ? metadata.capabilities : freezeMemoryCapabilities(metadata.capabilities);
  const capabilityDigest = memoryCapabilityDigest(capabilities);
  Object.defineProperty(tool, MEMORY_EFFECT_TOOL, { value: Object.freeze({ ...metadata, capabilities, capabilityDigest }), enumerable: false });
  return tool;
}

export function memoryEffectMetadata(tool: Tool): MemoryEffectToolMetadata | undefined {
  return (tool as unknown as Record<PropertyKey, unknown>)[MEMORY_EFFECT_TOOL] as MemoryEffectToolMetadata | undefined;
}

export function deriveMemoryBranchRequestId(outerRequestId: string, scope: "global" | "character"): string {
  return `memory-branch:${scope}:${createHash("sha256").update(`${outerRequestId}\0${scope}`).digest("hex")}`;
}
