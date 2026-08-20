/**
 * INPUT:  withStack process state, JSON logs/audit files, and optional node seed data
 * OUTPUT: shared JSON matching/reading, node seeding, and bounded full-stack teardown helpers
 * POS:    e2e/fixture support — lifecycle mechanics only; no scenario or production behavior
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Proc } from "./procs.ts";
import { killTree } from "./procs.ts";
import type { CapabilityRelay } from "./ws-relay.ts";
import { jsonLine } from "./line-buffer.ts";

export type JsonLogPredicate = (entry: Record<string, unknown>) => boolean;

export function matchJson(predicate: JsonLogPredicate): (raw: string) => boolean {
  return (raw) => {
    const entry = jsonLine(raw);
    return entry !== null && predicate(entry);
  };
}

export function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export function seedNodeState(dataDir: string, options: {
  execPolicy?: unknown;
  gateDecisions?: { capability: string; decision: "always" | "never" }[];
}): void {
  if (options.execPolicy !== undefined) {
    writeFileSync(join(dataDir, "exec-policy.json"), JSON.stringify(options.execPolicy));
  }
  if (options.gateDecisions !== undefined) {
    const decisions = options.gateDecisions.map((entry) => ({ ...entry, decidedAt: new Date().toISOString() }));
    writeFileSync(join(dataDir, "gate-decisions.json"), JSON.stringify({ decisions }));
  }
}

export async function teardownStack(parts: {
  operatorSocket: { close(): void } | null;
  node: Proc | null;
  secondNode: Proc | null;
  relay: CapabilityRelay | null;
  secondRelay: CapabilityRelay | null;
  core: Proc;
  coreDataDir: string;
  nodeDataDir: string;
  secondNodeDataDir: string | null;
}): Promise<void> {
  parts.operatorSocket?.close();
  if (parts.node) killTree(parts.node);
  if (parts.secondNode) killTree(parts.secondNode);
  await Promise.allSettled([parts.relay?.close(), parts.secondRelay?.close()]);
  killTree(parts.core);
  const exits = [parts.core.exited, ...(parts.node ? [parts.node.exited] : []), ...(parts.secondNode ? [parts.secondNode.exited] : [])];
  await Promise.allSettled(exits);
  for (const dir of [parts.coreDataDir, parts.nodeDataDir, parts.secondNodeDataDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
