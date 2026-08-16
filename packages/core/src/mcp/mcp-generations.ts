/**
 * INPUT:  one connected MCP client plus its published namespaced tools/refs (a runtime generation record)
 * OUTPUT: acquireLease/releaseLease/retireGeneration/closeGeneration — the frozen drain/close machinery: a
 *         draining generation accepts no new leases, closes exactly once at lease-zero or at the drain budget
 * POS:    core/mcp — plane-3 in-memory truth ONLY: generations and leases are never persisted, never restored
 */
import type { ToolSet } from "ai";
import type { McpClient } from "./mcp-connect.ts";
import type { McpToolRef } from "./mcp-tool-identity.ts";

export interface GenerationRecord {
  serverId: string;
  /** Process-local monotonic counter; a fresh process lineage starts over (never persisted as truth). */
  generation: number;
  client: McpClient;
  tools: ToolSet;
  refs: Map<string, McpToolRef>;
  leases: number;
  draining: boolean;
  closed: boolean;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

export function makeGenerationRecord(input: {
  serverId: string;
  generation: number;
  client: McpClient;
  tools: ToolSet;
  refs: Map<string, McpToolRef>;
}): GenerationRecord {
  return { ...input, leases: 0, draining: false, closed: false, closeTimer: null };
}

/** True when the lease was acquired; false means the generation retired and the call must fail closed. */
export function acquireLease(record: GenerationRecord): boolean {
  if (record.draining || record.closed) return false;
  record.leases += 1;
  return true;
}

export function releaseLease(record: GenerationRecord): void {
  record.leases = Math.max(0, record.leases - 1);
  if (record.draining && record.leases === 0 && !record.closed) void closeGeneration(record);
}

/**
 * Marks the generation draining (new leases refused) and schedules the bounded force-close. Callers must have
 * already removed it from the active map, so no future Run snapshot can capture it.
 */
export function retireGeneration(record: GenerationRecord, drainBudgetMs: number): void {
  if (record.closed) return;
  record.draining = true;
  if (record.leases === 0) {
    void closeGeneration(record);
    return;
  }
  record.closeTimer ??= setTimeout(() => void closeGeneration(record), drainBudgetMs);
}

/** Exactly-once client close (the single owner of the transport lifecycle until close completes). */
export async function closeGeneration(record: GenerationRecord): Promise<void> {
  if (record.closed) return;
  record.closed = true;
  if (record.closeTimer !== null) clearTimeout(record.closeTimer);
  record.closeTimer = null;
  await record.client.close().catch(() => undefined);
}
