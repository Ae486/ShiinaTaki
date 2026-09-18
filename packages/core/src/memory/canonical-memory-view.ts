/**
 * INPUT:  canonical records and opaque revision-bearing maintenance references
 * OUTPUT: legacy-policy-compatible row projections and validated canonical mutation targets
 * POS:    core/memory — presentation adapter only; reference strings are never filesystem paths
 */
import type { CanonicalMemoryRecord, TakiMemoryPolicyProjection } from "@taki/shared";
import { z } from "zod";
import type { MemoryEntryRow } from "../db/memory-repo.ts";

const Id = z.string().min(1).max(256);
const ReferenceSchema = z.tuple([Id, Id, Id, z.int().min(1)]);
const PREFIX = "cm:";
export type CanonicalMemoryViewRow = MemoryEntryRow & { visibility?: TakiMemoryPolicyProjection["visibility"] };

export interface CanonicalMemoryReference {
  epochId: string;
  bankId: string;
  memoryId: string;
  expectedRevision: number;
}

export function canonicalMemoryReference(input: CanonicalMemoryReference): string {
  const value = ReferenceSchema.parse([input.epochId, input.bankId, input.memoryId, input.expectedRevision]);
  return PREFIX + Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function parseCanonicalMemoryReference(value: string): CanonicalMemoryReference {
  try {
    if (!value.startsWith(PREFIX) || value.length > 8192) throw new Error("invalid reference");
    const encoded = value.slice(PREFIX.length);
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("invalid reference encoding");
    const [epochId, bankId, memoryId, expectedRevision] = ReferenceSchema.parse(JSON.parse(bytes.toString("utf8")));
    return { epochId, bankId, memoryId, expectedRevision };
  } catch {
    throw new Error("MEMORY_INVALID_REQUEST: invalid canonical memory reference");
  }
}

/** Reuse T5's pure policy/report code while retaining the exact revision it actually inspected. */
export function canonicalMemoryRow(record: CanonicalMemoryRecord, characterId: string | null): CanonicalMemoryViewRow {
  const { unit, policy } = record;
  const ref = canonicalMemoryReference({ epochId: unit.authorityEpochId, bankId: unit.bankId,
    memoryId: unit.memoryId, expectedRevision: unit.revision });
  return {
    id: ref, path: ref, characterId, layer: policy.layerId, importance: policy.importance,
    status: unit.state === "valid" ? "active" : "archived", createdAt: unit.createdAt, updatedAt: unit.updatedAt,
    origin: policy.origin, expiresAt: policy.retention.kind === "expiring" ? policy.retention.expiresAt : null,
    disclosure: policy.disclosure ?? "", content: unit.text, visibility: policy.visibility,
  };
}
