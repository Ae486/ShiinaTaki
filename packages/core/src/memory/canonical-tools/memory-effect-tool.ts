/**
 * Trusted, process-local sidecar for canonical Memory tools. Model input cannot alter these authority references.
 */
import { createHash } from "node:crypto";
import type { MemoryProviderCapabilities } from "@taki/shared";
import type { Tool } from "ai";

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
  const capabilityDigest = createHash("sha256").update(canonicalJson(metadata.capabilities)).digest("hex");
  Object.defineProperty(tool, MEMORY_EFFECT_TOOL, { value: Object.freeze({ ...metadata, capabilityDigest }), enumerable: false });
  return tool;
}

export function memoryEffectMetadata(tool: Tool): MemoryEffectToolMetadata | undefined {
  return (tool as unknown as Record<PropertyKey, unknown>)[MEMORY_EFFECT_TOOL] as MemoryEffectToolMetadata | undefined;
}

export function deriveMemoryBranchRequestId(outerRequestId: string, scope: "global" | "character"): string {
  return `memory-branch:${scope}:${createHash("sha256").update(`${outerRequestId}\0${scope}`).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("memory capability snapshot is not JSON-compatible");
}
