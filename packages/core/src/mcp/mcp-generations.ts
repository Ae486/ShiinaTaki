/**
 * INPUT:  one connected MCP client plus its published namespaced tools/refs (a runtime generation record)
 * OUTPUT: acquireLease/releaseLease/retireGeneration/closeGeneration — the frozen drain/close machinery: a
 *         draining generation rejects new leases and observes closed state before deferred transport cleanup
 * POS:    core/mcp — plane-3 in-memory truth ONLY: generations and leases are never persisted, never restored
 */
import type { ToolSet } from "ai";
import type { McpClient } from "./mcp-connect.ts";
import { closeMcpClient } from "./mcp-client-close.ts";
import type { McpToolRef } from "./mcp-tool-identity.ts";
import { notifyExtensionChange, type ExtensionChangeObserver } from "../extensions/notify-extension-change.ts";

export interface GenerationRecord {
  serverId: string;
  ownerHostId: string;
  configRevision: number;
  /** Process-local monotonic counter; a fresh process lineage starts over (never persisted as truth). */
  generation: number;
  client: McpClient;
  tools: ToolSet;
  refs: Map<string, McpToolRef>;
  leases: number;
  draining: boolean;
  closed: boolean;
  forcedClosed: boolean;
  secretRefs: ReadonlySet<string>;
  closeTimer: ReturnType<typeof setTimeout> | null;
  closePromise: Promise<void> | null;
  onClosed?: (record: GenerationRecord) => void;
  onClosedState?: ExtensionChangeObserver;
}

export function makeGenerationRecord(input: {
  serverId: string;
  ownerHostId: string;
  configRevision: number;
  generation: number;
  client: McpClient;
  tools: ToolSet;
  refs: Map<string, McpToolRef>;
  secretRefs: ReadonlySet<string>;
  onClosed?: (record: GenerationRecord) => void;
  onClosedState?: ExtensionChangeObserver;
}): GenerationRecord {
  return {
    ...input,
    leases: 0,
    draining: false,
    closed: false,
    forcedClosed: false,
    closeTimer: null,
    closePromise: null,
  };
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
  record.closeTimer ??= setTimeout(() => void closeGeneration(record, true), drainBudgetMs);
}

/** Shared generation close; `force` marks leased calls outcome-unknown before the transport is interrupted. */
export function closeGeneration(record: GenerationRecord, force = false): Promise<void> {
  if (force && record.leases > 0) record.forcedClosed = true;
  if (record.closePromise) return record.closePromise;
  record.closed = true;
  if (record.closeTimer !== null) clearTimeout(record.closeTimer);
  record.closeTimer = null;
  record.closePromise = closeMcpClient(record.client).finally(() => record.onClosed?.(record));
  // Install the shared close promise before observing this state so reentrant closes join it. The old
  // onClosed callback still owns cleanup only after the potentially deferred transport close settles.
  notifyExtensionChange(record.onClosedState, ["mcp"]);
  return record.closePromise;
}
